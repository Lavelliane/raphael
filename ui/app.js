"use strict";
const $ = id => document.getElementById(id);
const paths = {
  plus:"M12 5v14M5 12h14", wave:"M2 12h3l2-6 3 13 3-15 3 12 2-4h4", play:"m8 5 11 7-11 7z",
  settings:"M3 6h8m4 0h6M3 12h2m4 0h12M3 18h11m4 0h3M11 3v6M6 9v6M15 15v6",
  folder:"M3 6h6l2 2h10v11H3z", hash:"M9 3 6 21M17 3l-3 18M3 9h18M2 15h18",
  panel:"M3 4h18v16H3zM9 4v16", audio:"M4 10h4l5-4v12l-5-4H4zM16 9q4 3 0 6M18 5q8 7 0 14",
  edit:"m5 15 10-10 4 4L9 19l-5 1z", cpu:"M6 6h12v12H6zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4M18 9h4m-4 6h4",
  spark:"m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  terminal:"m4 7 5 5-5 5m8 1h8", arrow:"M12 19V5m-6 6 6-6 6 6", close:"m5 5 14 14M19 5 5 19",
  check:"m3 12 5 5L20 5", explain:"M3 5h18M3 11h14M3 17h10", insight:"M9 18h6m-5 3h4M8 15c0-2-3-3-3-7a7 7 0 0 1 14 0c0 4-3 5-3 7z",
  diagram:"M9 3h6v5H9zM2 16h6v5H2zm14 0h6v5h-6zM12 8v4M5 16v-4h14v4", menu:"M3 6h18M3 12h18M3 18h18"
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[name]+'"/></svg>';
document.querySelectorAll("[data-icon]").forEach(el => el.innerHTML=icon(el.dataset.icon));
const personalities = {
  sage:["Great Sage","Calm, precise, and direct."], pair:["Pair programmer","Conversational and practical."],
  reviewer:["Reviewer","Checks assumptions and asks for evidence."], coach:["Coach","Encouraging, with a concrete next step."]
};
const sprites = {
  sage:["..1111..",".111111.","11.11.11",".111111.","..1111..","...11..."],
  slime:["........","...11...","..1111..",".111111.","11.11.11",".111111."],
  flame:["....1...","..1.11..","..1111..",".111111.",".11..11.","..1111.."],
  orbit:["..1111..",".11..11.","11.11.11","11.11.11",".11..11.","..1111.."]
};
const names={sage:"Sage",slime:"Slime",flame:"Ember",orbit:"Orbit"};
function avatar(key) {
  let cells="";
  sprites[key].forEach((row,y)=>[...row].forEach((c,x)=>{if(c==="1") cells+='<rect x="'+x+'" y="'+(y+1)+'" width="1" height="1"/>';}));
  return '<span class="avatar '+key+'"><svg viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">'+cells+'</svg></span>';
}
const defaults={personality:"sage",avatar:"sage",topics:["codebase refactoring","architecture","software design"],folder:"",handsFree:true,model:"fast"};
let prefs;
try {prefs={...defaults,...JSON.parse(localStorage.getItem("raphael.preferences")||"{}")};} catch {prefs={...defaults};}
if (!Object.hasOwn(sprites,prefs.avatar)) prefs.avatar="sage";
if (!Object.hasOwn(personalities,prefs.personality)) prefs.personality="sage";
function save(){localStorage.setItem("raphael.preferences",JSON.stringify(prefs));}
const demoTurns=[
  {id:1,time:"00:04",text:"Can we move the checkout queries into a repository this sprint?"},
  {id:2,time:"00:11",text:"May integration test na for checkout. We can use it to compare the old and new behavior."},
  {id:3,time:"00:19",text:"Anong direction natin for the refactor: one large change or per feature?"}
];
const samples={
  answer:{title:"Start with one feature",body:"Per feature tayo. Start with checkout, keep the integration test green, and use that first change as the pattern for the next migration."},
  check:{title:"Check the test first",body:"Someone mentioned a checkout integration test. Ask for its path and run it before relying on its coverage."},
  explain:{title:"Why move one flow?",body:"A small migration gives the team one place to compare behavior. If checkout changes unexpectedly, the diff is easier to inspect."},
  insight:{title:"Ask about rollback",body:"If the new query changes a customer’s total, can we revert checkout without rolling back unrelated work?"},
  diagram:{title:"One feature at a time",body:"Repeat the migration only after checkout behavior is verified.",nodes:["Baseline test","Migrate query","Verify checkout","Repeat"]},
  ask:{title:"Example workspace",body:"Example replies are scripted. Switch to Live workspace to ask Codex a question about your own meeting or folder."}
};
const actions=[["answer","Answer question","terminal"],["check","Check claim","check"],["explain","Explain","explain"],["insight","Insight","insight"],["diagram","Diagram","diagram"]];
let demo=false, live={turns:[],active:false}, liveCards=[], demoCards=[samples.answer], busy=false, seq=0;
let dialogSubmit=null, dialogId=0, catalog={models:[],fast:""}, stateRevision=0, lastCardsKey="";
const kindLabels={answer:"Suggested answer",correction:"Claim check",possible_correction:"Possible correction",explain:"Explanation",followup:"Follow-up"};
const handsFreeControl='<label class="checkbox"><input type="checkbox" id="hands-free"> Hands-free assistance</label><p>Send new speech and recent context to Codex for short suggestions. Uses your plan’s Codex allowance.</p>';
function assistantSettings(settings=prefs){
  return {enabled:settings.handsFree,model:settings.model,topics:settings.topics,personality:settings.personality,folder:settings.folder};
}
function modelOptions(select,choice){
  const label=catalog.fast?"Fast · "+catalog.fast:"Fast · Codex default";
  const choices=[["fast",label],["default","Codex default"],...catalog.models.map(m=>[m.id,m.name])];
  if(!choices.some(([id])=>id===choice))choices.push([choice,choice+" (unavailable)"]);
  select.replaceChildren(...choices.map(([id,name])=>new Option(name,id)));
  select.value=choice;
}
async function refreshModels(){
  try{catalog=await api("models");}catch{return;}
  modelOptions($("session-model"),prefs.model);
  if($("settings-model"))modelOptions($("settings-model"),$("settings-model").value);
  if($("model-hint"))$("model-hint").textContent=modelHint();
}
function modelHint(){
  return catalog.models.length?"Fast prefers a lightweight model. Pick Codex default to use your CLI’s model and reasoning settings.":"Model discovery is unavailable. Fast will use the CLI default. Update Codex CLI to list individual models.";
}
async function updatePrefs(changes){
  const next={...prefs,...changes};
  if(live.active)await api("assistant",assistantSettings(next));
  Object.assign(prefs,changes);save();modelOptions($("session-model"),prefs.model);render();
}
$("session-model").onchange=async e=>{
  const select=e.target;select.disabled=true;
  try{await updatePrefs({model:select.value});}catch(err){status(err.message);select.value=prefs.model;}
  finally{select.disabled=demo;}
};
const elem=(tag,cls,txt)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(txt!==undefined)el.textContent=txt;return el;};
async function api(route,data={}){
  const res=await fetch("/api/"+route,{method:"POST",headers:{"Content-Type":"application/json","X-Raphael-Token":document.querySelector('meta[name="raphael-token"]').content},body:JSON.stringify(data)});
  const result=await res.json();
  if(!res.ok) throw Error(result.error||"The local service could not complete that request.");
  return result;
}
function status(msg){$("feedback").textContent=msg;}
function timeText(n){const secs=Math.max(0,Math.floor(n));return Math.floor(secs/60).toString().padStart(2,"0")+":"+(secs%60).toString().padStart(2,"0");}
function showCards(){
  const box=$("cards"), cards=demo?demoCards:[...liveCards,...(live.copilot?.cards||[])].sort((a,b)=>a.timestamp-b.timestamp);
  const key=JSON.stringify([demo,prefs.avatar,prefs.handsFree,live.active,cards.length,cards.slice(-3)]);
  if(key===lastCardsKey)return;
  lastCardsKey=key;box.replaceChildren();
  $("card-count").textContent=cards.length ? cards.length+" "+(cards.length===1?"CARD":"CARDS") : "";
  if(!cards.length) box.append(elem("p","quiet",prefs.handsFree?"Raphael will suggest a reply, clarify an idea, or flag a claim as the conversation unfolds.":"Choose an action or ask a question for a short answer."));
  cards.slice(-3).reverse().forEach(card=>{
    const row=elem("div","card"), face=elem("span"), body=elem("div");face.innerHTML=avatar(prefs.avatar);
    if(card.id&&kindLabels[card.kind])body.append(elem("div","card-kind",kindLabels[card.kind]));
    body.append(elem("b","",card.title),elem("p","",card.body));
    if(card.source){const src=elem("button","source",card.source);src.onclick=()=>viewSource(card);body.append(src);}
    if(card.nodes?.length){const flow=elem("div","flow");card.nodes.forEach((label,i)=>{if(i)flow.append("→");flow.append(elem("span","",label));});body.append(flow);}
    row.append(face,body);box.append(row);
  });
}
function render(){
  $("crumb").textContent=demo?"Example session":"Live session";$("session-title").textContent=demo?"Refactoring review":"Live session";
  $("top-status").textContent=demo?"Example":live.active?"Listening":"Standby";$("top-status").classList.toggle("active",!demo&&live.active);
  $("listen").innerHTML=icon(demo?"play":"wave")+"<span>"+(demo?"Open live workspace":live.active?"Stop listening":"Start listening")+"</span>";
  $("nav-live").classList.toggle("selected",!demo);$("nav-demo").classList.toggle("selected",demo);
  $("foot-state").textContent=demo?"Example · scripted transcript and answers":"Local workspace";
  $("folder-label").textContent=demo?"checkout-example":prefs.folder.split(/[\\/]/).filter(Boolean).pop()||"No folder attached";
  $("source-label").textContent=demo?"Example recording":(live.active?"Playback · listening":"System playback");
  $("topics").replaceChildren(...(demo?defaults.topics:prefs.topics).map(t=>elem("span","topic",t)));
  $("side-avatar").innerHTML=avatar(prefs.avatar);$("side-persona").textContent=personalities[prefs.personality][0];
  const turns=demo?demoTurns:live.turns, log=$("transcript");
  const stick=log.scrollHeight-log.scrollTop-log.clientHeight<30;
  log.replaceChildren();
  if(!turns.length)log.append(elem("p","quiet",live.active?"Listening for speech from your playback device…":"Start listening to transcribe English and Tagalog from your system audio."));
  turns.forEach(t=>{const row=elem("div",/[?？]/.test(t.text)?"turn question":"turn");row.append(elem("span","time",t.time||timeText(t.timestamp-live.started)),elem("p","",t.text));log.append(row);});
  if(stick) log.scrollTop=log.scrollHeight;
  $("transcript-meta").textContent=demo?"EXAMPLE · EN / TL":"EN / TL";
  $("meter").replaceChildren(...Array.from({length:22},(_,i)=>elem("b",!demo&&live.active&&i<Math.round(live.level*22)?"on":"")));
  $("edit-folder").disabled=$("edit-topics").disabled=demo;
  $("session-model").disabled=demo;
  $("assistant-state").textContent=demo?"Scripted replies":live.copilot?.error&&live.active?live.copilot.error:
    live.active&&live.copilot?.busy?"Considering the conversation…":
    (live.active?live.copilot?.enabled:prefs.handsFree)?"Hands-free · ChatGPT login":"Manual · ChatGPT login";
  showCards();
}
function modal(title,html,confirm,submit){
  dialogId++;dialogSubmit=submit;$("dialog-title").textContent=title;$("dialog-body").innerHTML=html;$("dialog-error").textContent="";
  $("confirm").textContent=confirm;$("confirm").disabled=false;$("dialog").showModal();return dialogId;
}
$("dialog-form").onsubmit=async e=>{e.preventDefault();const id=dialogId;$("confirm").disabled=true;try{await dialogSubmit();if(id===dialogId)$("dialog").close();}catch(err){if(id===dialogId)$("dialog-error").textContent=err.message;}finally{if(id===dialogId)$("confirm").disabled=false;}};
$("cancel").onclick=$("close").onclick=()=>$("dialog").close();
$("dialog").addEventListener("close",()=>{dialogId++;});
async function viewSource(card){
  modal("Source excerpt",'<pre class="source-text" id="excerpt"></pre>',"Done",()=>{});
  try{const result=await api("source",{folder:card.folder,source:card.source});if($("excerpt"))$("excerpt").textContent=result.excerpt;}
  catch(err){$("dialog-error").textContent=err.message;}
}
$("settings").onclick=()=>{
  $("sidebar").classList.remove("open");let selected=prefs.avatar;
  modal("Settings",'<label for="persona">Assistant personality</label><select id="persona"></select><p id="hint"></p><label>Avatar</label><div class="choice-list" id="avatar-list"></div><label for="settings-model">Codex model</label><select id="settings-model"></select><p id="model-hint"></p>'+handsFreeControl,"Save settings",async()=>{
    await updatePrefs({personality:$("persona").value,avatar:selected,handsFree:$("hands-free").checked,model:$("settings-model").value});
  });
  for(const [id,[name]] of Object.entries(personalities))$("persona").add(new Option(name,id));
  $("persona").value=prefs.personality;$("hands-free").checked=prefs.handsFree;
  modelOptions($("settings-model"),prefs.model);$("model-hint").textContent=modelHint();void refreshModels();
  $("persona").onchange=()=>$("hint").textContent=personalities[$("persona").value][1];$("persona").onchange();
  const paint=()=>{$("avatar-list").replaceChildren();Object.keys(sprites).forEach(id=>{const b=elem("button");b.type="button";b.title=names[id];b.setAttribute("aria-label",names[id]);b.setAttribute("aria-pressed",String(selected===id));b.innerHTML=avatar(id);b.onclick=()=>{selected=id;paint();};$("avatar-list").append(b);});};paint();
};
$("edit-folder").onclick=()=>{
  modal("Connect a folder",'<label for="folder">Local folder path</label><input id="folder" placeholder="/path/to/project"><p>Codex can read this folder for answers. Clear the field to disconnect it.</p>',"Apply",async()=>{
    const value=$("folder").value.trim();await updatePrefs({folder:value?(await api("folder",{path:value})).path:""});
  });$("folder").value=prefs.folder;$("folder").focus();
};
$("edit-topics").onclick=()=>{
  modal("Watch topics",'<label for="topic-input">One topic per line</label><textarea id="topic-input" rows="5"></textarea>',"Save topics",async()=>{
    await updatePrefs({topics:[...new Set($("topic-input").value.split(/[,\n]/).map(t=>t.trim()).filter(Boolean))].slice(0,12)});
  });$("topic-input").value=prefs.topics.join("\n");
};
async function startDialog(){
  const id=modal("Start listening",'<label for="device">Playback device</label><select id="device"></select><p>Raphael listens to audio played through this output. Let participants know before starting.</p>'+handsFreeControl,"Listen",async()=>{
    if(!$("device").value)throw Error("Choose an available playback device.");
    const device = $("device").value;
    $("confirm").textContent = "Preparing Whisper…";
    try {
      await api("prepare-whisper");
      if (id !== dialogId || !$("dialog").open) return;
      const handsFree=$("hands-free").checked;
      live = await api("start", {device,assistant:assistantSettings({...prefs,handsFree})});
      stateRevision++;prefs.handsFree=handsFree;save();
      status("");
      render();
    } finally {
      if (id === dialogId) $("confirm").textContent = "Listen";
    }
  });
  $("hands-free").checked=prefs.handsFree;
  $("confirm").disabled=true;
  try{const ds=await api("devices");if(id!==dialogId)return;
    if(!ds.length)throw Error("No playback monitor found. Check the audio setup for your OS in the README.");
    ds.forEach(d=>$("device").add(new Option(d.name,d.id)));$("confirm").disabled=false;
  }catch(err){if(id===dialogId)$("dialog-error").textContent=err.message;}
}
function switchView(example){
  if(example&&live.active){status("Stop listening before opening the example.");return;}
  demo=example;$("sidebar").classList.remove("open");status("");render();
}
$("nav-live").onclick=()=>switchView(false);$("nav-demo").onclick=()=>switchView(true);
$("mobile-menu").onclick=()=>$("sidebar").classList.toggle("open");
$("new").onclick=()=>{
  $("sidebar").classList.remove("open");
  modal("New session","<p>Clear the current live transcript and answer cards? Your topics, folder and settings carry over.</p>","New session",async()=>{
    live=await api("new");seq++;busy=false;stateRevision++;liveCards=[];lockActions(false);switchView(false);
  });
};
$("listen").onclick=async()=>{try{if(demo)return switchView(false);if(live.active){live=await api("stop");stateRevision++;render();}else await startDialog();}catch(err){status(err.message);}};
function lockActions(on){[...$("commands").children,$("ask-form").querySelector("button")].forEach(b=>b.disabled=on);}
async function ask(action,question=""){
  if(busy)return;
  if(demo){demoCards.push(samples[action]);if(demoCards.length>20)demoCards.shift();render();return;}
  if(!live.turns.length&&!question){status("Start listening first, or type a question for Codex.");return;}
  const generation=seq;busy=true;lockActions(true);status("Raphael is thinking…");const folder=prefs.folder;
  try{
    const reply=await api("answer",{action,question,turns:live.turns.slice(-12).map(t=>t.text),topics:prefs.topics,personality:prefs.personality,model:prefs.model,folder});
    if(seq!==generation)return;liveCards.push({...reply,folder,timestamp:Date.now()/1000});if(liveCards.length>50)liveCards.shift();status("");render();
  }catch(err){if(seq===generation)status(err.message);}finally{if(seq===generation){busy=false;lockActions(false);}}
}
actions.forEach(([key,label,symbol])=>{const button=elem("button");button.innerHTML=icon(symbol);button.append(label);button.onclick=()=>ask(key);$("commands").append(button);});
$("ask-form").onsubmit=e=>{e.preventDefault();const q=$("question").value.trim();if(q&&!busy){$("question").value="";ask("ask",q);}};
async function poll(){
  try{
    const revision=stateRevision;
    const current=await api("state");
    if(revision!==stateRevision)return;
    const before=live;live=current;
    if(!demo){
      if(live.active!==before.active||live.turns.at(-1)?.id!==before.turns.at(-1)?.id||live.level!==before.level||JSON.stringify(live.copilot)!==JSON.stringify(before.copilot))render();
      if(live.error&&live.error!==before.error)status(live.error);
      if(live.dropped>before.dropped)status("Audio processing fell behind. Some speech was skipped.");
    }
  }catch(err){if(!demo)status("Lost connection to the local Raphael service.");}
  finally{setTimeout(poll,750);}
}
modelOptions($("session-model"),prefs.model);render();void poll();void refreshModels();
