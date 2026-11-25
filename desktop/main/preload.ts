import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("raphael", {
  platform: process.platform,
  request: (route: string, data = {}) =>
    ipcRenderer.invoke("meeting:request", route, data),
  chooseFolder: () => ipcRenderer.invoke("meeting:folder"),
});
