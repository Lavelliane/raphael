import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  session,
  type IpcMainInvokeEvent,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Backend } from "./backend";

const entry = path.join(app.getAppPath(), "dist/renderer/index.html");
const allowed = new Set([
  "state",
  "models",
  "devices",
  "start",
  "stop",
  "new",
  "assistant",
  "folder",
  "source",
  "answer",
]);
const backend = new Backend(app.getAppPath(), app.isPackaged);
let window: BrowserWindow | null = null;
let quitting = false;

function localFrame(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== pathToFileURL(entry).href
  )
    throw Error("Unrecognized window.");
}

function open() {
  window = new BrowserWindow({
    title: "Raphael",
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#050505",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 19 },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("closed", () => {
    window = null;
  });
  void window.loadFile(entry);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setName("Raphael");
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(() => {
    nativeTheme.themeSource = "dark";
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    ipcMain.handle("meeting:request", (event, route: string, data: unknown) => {
      localFrame(event);
      if (!allowed.has(route)) throw Error("Unknown meeting action.");
      return backend.request(route, data);
    });
    ipcMain.handle("meeting:folder", async (event) => {
      localFrame(event);
      const choice = await dialog.showOpenDialog(window!, {
        properties: ["openDirectory"],
      });
      return choice.canceled ? null : choice.filePaths[0];
    });
    open();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void backend.close().finally(() => app.quit());
  });
}
