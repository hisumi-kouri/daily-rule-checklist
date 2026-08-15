import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://nhyikuzvigfzrcgetxej.supabase.co";
const SUPABASE_KEY = "sb_publishable_WrbDksID8cIESwNpSX5AkQ_Z3hHSSAG";
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

const base=[];

let supabaseReady=false, user=null;
let state={checks:{}, custom:[], priority:[], medications:[], parameters:{sleepHours:"",hallucinations:[],note:""}, parameterRowId:null};
const BASE_SENTINEL_CATEGORY="__system__";
const BASE_SENTINEL_TEXT="__base_initialized_v1__";
const BASIC_RULES_SENTINEL_TEXT="__basic_rules_initialized_v2__";
const LIFE_RULES_SENTINEL_TEXT="__life_rules_initialized_v1__";
const WORK_RULES_SENTINEL_TEXT="__work_rules_initialized_v1__";
const MEDICAL_RULES_SENTINEL_TEXT="__medical_rules_initialized_v1__";
const DEFAULT_LIFE_RULES=[
  {text:"朝薬を飲んだ",source:""},
  {text:"昼薬を飲んだ",source:""},
  {text:"夕薬を飲んだ",source:""},
  {text:"就寝薬を飲んだ",source:""},
  {text:"頓服を飲んだ",source:"頓服を飲んだ場合は、必要に応じて補足を入力できます。"}
];
const NON_ACHIEVEMENT_RULES=new Set(["頓服を飲んだ","高松さんへの週１回の近状メールを送る","訪問看護とまとめた内容をチャッピーに入力","先生にきちんと見せる","３回出品してから値下げ"]);
const DEFAULT_BASIC_RULES=[
  "睡眠薬を飲んだ",
  "遅刻しそうな時は午後から出勤する",
  "犬のふんを掃除した",
  "高松さんへの週１回の近状メールを送る"
];
const PRIORITY_CATEGORY="__priority__";
const PRIORITY_SENTINEL_TEXT="__priority_initialized_v1__";
const MEDICATION_CATEGORY="__medication__";
const DAILY_PARAMETER_CATEGORY="__daily_parameters__";
const DAILY_MENTAL_CATEGORY="__daily_mental__";
const DEFAULT_PRIORITIES=["体調第一","生活","仕事"];
const URGE_TYPES=[
  {id:"vanish",label:"消えたい衝動"},
  {id:"die",label:"死にたい衝動"},
  {id:"mood",label:"気分"},
  {id:"anxiety",label:"不安"},
  {id:"irritability",label:"イライラ"},
  {id:"fatigue",label:"疲労感"}
];
const day=()=>{
  const d=new Date();
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
};
const statusEl=document.getElementById("syncStatus");
const accountStatus=document.getElementById("accountStatus");
const anonPanel=document.getElementById("anonymousPanel");
const loggedInPanel=document.getElementById("loggedInPanel");
const signOutBtn=document.getElementById("signOutBtn");

function setStatus(t){statusEl.textContent=t;}
function setAuthMessage(t){document.getElementById("authMessage").textContent=t;}
function setAnonAuthMessage(t){document.getElementById("anonAuthMessage").textContent=t;}

function baseItems(){
  const arr=[];
  for(const [cat,items] of base) for(const [text,source] of items) arr.push({cat,text,source});
  return arr;
}

function allItems(){
  const rules=state.custom
    .filter(x=>x.cat!==MEDICATION_CATEGORY)
    .map(x=>({...x,id:`c:${x.id}`,trackAchievement:!NON_ACHIEVEMENT_RULES.has(x.text)}));
  const meds=(state.medications||[]).map(x=>({
    id:`m:${x.id}`, cat:"服薬管理", text:`${x.name}${x.dose?`（${x.dose}）`:""}${x.timing?`・${x.timing}`:""}`, source:x.note||""
  }));
  return [...rules,...meds];
}

function priorityItems(){
  return state.priority||[];
}

async function insertRuleRow(userId,rule){
  let res=await supabaseClient.from("custom_rules")
    .insert({user_id:userId,text:rule.text,category:rule.cat,source:rule.source||""}).select().single();
  // source列がまだ無い古いDBでも動くようにフォールバック
  if(res.error && /source|column/i.test(res.error.message||"")){
    res=await supabaseClient.from("custom_rules")
      .insert({user_id:userId,text:rule.text,category:rule.cat}).select().single();
  }
  return res;
}

const REMOVED_CATEGORIES=["職場・基本ルール","出品ルール","リタリコブログ","今日の確認"];
async function removeDeletedCategories(){
  if(!supabaseReady||!user)return;
  const uid=user.id;
  const res=await supabaseClient.from("custom_rules").select("id,category").eq("user_id",uid).in("category",REMOVED_CATEGORIES);
  if(res.error) throw res.error;
  const ids=(res.data||[]).map(x=>`c:${x.id}`);
  if(ids.length){
    const delChecks=await supabaseClient.from("daily_check_states").delete().eq("user_id",uid).in("item_id",ids);
    if(delChecks.error) throw delChecks.error;
  }
  const delRules=await supabaseClient.from("custom_rules").delete().eq("user_id",uid).in("category",REMOVED_CATEGORIES);
  if(delRules.error) throw delRules.error;
}

async function ensureBaseRules(){
  if(!supabaseReady||!user)return;
  const uid=user.id;
  const marker=await supabaseClient.from("custom_rules").select("id").eq("user_id",uid)
    .eq("category",BASE_SENTINEL_CATEGORY).eq("text",BASE_SENTINEL_TEXT).limit(1);
  if(marker.error) throw marker.error;
  if(marker.data?.length) return;

  // 既存のチェック状態を退避して、初期ルールをアカウント管理のルールへ移行する。
  const oldChecks=await supabaseClient.from("daily_check_states").select("item_id,checked")
    .eq("user_id",uid).eq("check_date",day());
  if(oldChecks.error) throw oldChecks.error;
  const checked=new Map((oldChecks.data||[]).map(x=>[x.item_id,!!x.checked]));

  const existing=await supabaseClient.from("custom_rules").select("id,text,category").eq("user_id",uid);
  if(existing.error) throw existing.error;
  const rows=existing.data||[];

  for(const rule of baseItems()){
    let found=rows.find(x=>x.text===rule.text && x.category===rule.cat);
    if(!found){
      const res=await insertRuleRow(uid,rule);
      if(res.error) throw res.error;
      found=res.data;
      rows.push(found);
    }
    const oldId=`b:${rule.cat}:${rule.text}`;
    if(checked.get(oldId)){
      const res=await supabaseClient.from("daily_check_states").upsert({
        user_id:uid,check_date:day(),item_id:`c:${found.id}`,checked:true
      },{onConflict:"user_id,check_date,item_id"});
      if(res.error) throw res.error;
    }
  }

  const markerInsert=await supabaseClient.from("custom_rules")
    .insert({user_id:uid,text:BASE_SENTINEL_TEXT,category:BASE_SENTINEL_CATEGORY});
  if(markerInsert.error) throw markerInsert.error;
}

async function ensureBasicRules(){
  if(!supabaseReady||!user)return;
  const uid=user.id;
  const marker=await supabaseClient.from("custom_rules").select("id").eq("user_id",uid)
    .eq("category",BASE_SENTINEL_CATEGORY).eq("text",BASIC_RULES_SENTINEL_TEXT).limit(1);
  if(marker.error) throw marker.error;
  if(marker.data?.length) return;

  const existing=await supabaseClient.from("custom_rules").select("id,text,category").eq("user_id",uid);
  if(existing.error) throw existing.error;
  const rows=existing.data||[];
  for(const text of DEFAULT_BASIC_RULES){
    if(rows.some(x=>x.text===text && x.category==="基本")) continue;
    const res=await insertRuleRow(uid,{text,cat:"基本",source:""});
    if(res.error) throw res.error;
    rows.push(res.data);
  }
  const markerInsert=await supabaseClient.from("custom_rules")
    .insert({user_id:uid,text:BASIC_RULES_SENTINEL_TEXT,category:BASE_SENTINEL_CATEGORY});
  if(markerInsert.error) throw markerInsert.error;
}

async function ensureLifeRules(){
  if(!supabaseReady||!user)return;
  const uid=user.id;
  const marker=await supabaseClient.from("custom_rules").select("id").eq("user_id",uid)
    .eq("category",BASE_SENTINEL_CATEGORY).eq("text",LIFE_RULES_SENTINEL_TEXT).limit(1);
  if(marker.error) throw marker.error;
  if(marker.data?.length) return;
  let existing=await supabaseClient.from("custom_rules").select("id,text,category,source").eq("user_id",uid);
  if(existing.error && /source|column/i.test(existing.error.message||"")){
    existing=await supabaseClient.from("custom_rules").select("id,text,category").eq("user_id",uid);
  }
  if(existing.error) throw existing.error;
  const rows=existing.data||[];
  for(const rule of DEFAULT_LIFE_RULES){
    let found=rows.find(x=>x.text===rule.text && x.category==="生活");
    if(!found){
      const res=await insertRuleRow(uid,{text:rule.text,cat:"生活",source:rule.source||""});
      if(res.error) throw res.error;
      found=res.data; rows.push(found);
    }
  }
  const markerInsert=await supabaseClient.from("custom_rules")
    .insert({user_id:uid,text:LIFE_RULES_SENTINEL_TEXT,category:BASE_SENTINEL_CATEGORY});
  if(markerInsert.error) throw markerInsert.error;
}

async function ensureAdditionalWorkRules(){
  if(!supabaseReady||!user)return;
  const uid=user.id;
  const additionalRules=[
    "ミスはすぐに報告",
    "勝手に判断しない",
    "３回出品してから値下げ",
    "外界の音が気になる時はイヤフォンの使用可"
  ];
  const existing=await supabaseClient.from("custom_rules").select("id,text,category").eq("user_id",uid).eq("category","職場");
  if(existing.error) throw existing.error;
  const rows=existing.data||[];
  for(const text of additionalRules){
    if(rows.some(x=>x.text===text)) continue;
    const res=await insertRuleRow(uid,{text,cat:"職場",source:""});
    if(res.error) throw res.error;
    rows.push(res.data);
  }
}

async function ensureWorkRules(){
  if(!supabaseReady||!user)return;
  const uid=user.id;
  const marker=await supabaseClient.from("custom_rules").select("id").eq("user_id",uid)
    .eq("category",BASE_SENTINEL_CATEGORY).eq("text",WORK_RULES_SENTINEL_TEXT).limit(1);
  if(marker.error) throw marker.error;
  if(marker.data?.length) return;
  const defaultRules=[
    "指示を受けたらチャッピーに送る",
    "利用者への直接指示はしない",
    "職員を通して伝える",
    "ヤフオクの再撮影はまとめて伝える",
    "全体共有チャットを利用",
    "個人面談中は送信しない",
    "分からない商品は飛ばす",
    "質問はまとめて質問"
  ];
  const existing=await supabaseClient.from("custom_rules").select("id,text,category").eq("user_id",uid);
  if(existing.error) throw existing.error;
  const rows=existing.data||[];
  for(const text of defaultRules){
    if(rows.some(x=>x.text===text && x.category==="職場")) continue;
    const res=await insertRuleRow(uid,{text,cat:"職場",source:""});
    if(res.error) throw res.error;
    rows.push(res.data);
  }
  const markerInsert=await supabaseClient.from("custom_rules")
    .insert({user_id:uid,text:WORK_RULES_SENTINEL_TEXT,category:BASE_SENTINEL_CATEGORY});
  if(markerInsert.error) throw markerInsert.error;
}

async function ensureMedicalRules(){
  if(!supabaseReady||!user)return;
  const uid=user.id;
  const marker=await supabaseClient.from("custom_rules").select("id").eq("user_id",uid)
    .eq("category",BASE_SENTINEL_CATEGORY).eq("text",MEDICAL_RULES_SENTINEL_TEXT).limit(1);
  if(marker.error) throw marker.error;
  if(marker.data?.length) return;
  const rules=["訪問看護とまとめた内容をチャッピーに入力","先生にきちんと見せる"];
  const existing=await supabaseClient.from("custom_rules").select("id,text,category").eq("user_id",uid).eq("category","通院");
  if(existing.error) throw existing.error;
  const rows=existing.data||[];
  for(const text of rules){
    if(rows.some(x=>x.text===text)) continue;
    const res=await insertRuleRow(uid,{text,cat:"通院",source:""});
    if(res.error) throw res.error;
    rows.push(res.data);
  }
  const markerInsert=await supabaseClient.from("custom_rules")
    .insert({user_id:uid,text:MEDICAL_RULES_SENTINEL_TEXT,category:BASE_SENTINEL_CATEGORY});
  if(markerInsert.error) throw markerInsert.error;
}

async function ensurePriorityRules(){
  if(!supabaseReady||!user)return;
  const uid=user.id;
  const marker=await supabaseClient.from("custom_rules").select("id").eq("user_id",uid)
    .eq("category",PRIORITY_CATEGORY).eq("text",PRIORITY_SENTINEL_TEXT).limit(1);
  if(marker.error) throw marker.error;
  if(marker.data?.length) return;

  const existing=await supabaseClient.from("custom_rules").select("id,text,category").eq("user_id",uid).eq("category",PRIORITY_CATEGORY);
  if(existing.error) throw existing.error;
  const rows=existing.data||[];
  for(const text of DEFAULT_PRIORITIES){
    if(rows.some(x=>x.text===text)) continue;
    const res=await insertRuleRow(uid,{text,cat:PRIORITY_CATEGORY,source:""});
    if(res.error) throw res.error;
    rows.push(res.data);
  }
  const markerInsert=await supabaseClient.from("custom_rules")
    .insert({user_id:uid,text:PRIORITY_SENTINEL_TEXT,category:PRIORITY_CATEGORY});
  if(markerInsert.error) throw markerInsert.error;
}

function parseMedicationRow(row){
  try{
    const data=JSON.parse(row.text);
    if(data && data.name) return {id:row.id,name:data.name,dose:data.dose||"",timing:data.timing||"",note:data.note||""};
  }catch(e){}
  return {id:row.id,name:row.text||"",dose:"",timing:"",note:row.source||""};
}

async function addMedication(data){
  if(!user)return;
  const payload=JSON.stringify({name:data.name,dose:data.dose||"",timing:data.timing||"",note:data.note||""});
  const res=await supabaseClient.from("custom_rules").insert({user_id:user.id,text:payload,category:MEDICATION_CATEGORY,source:data.note||""}).select().single();
  if(res.error){setStatus("⚠️ 服薬の追加に失敗"); console.error(res.error); return;}
  state.medications.push(parseMedicationRow(res.data));
  setStatus("☁️ 服薬を追加しました"); renderMedication();
}

async function editMedication(id){
  const med=state.medications.find(x=>String(x.id)===String(id));
  if(!med)return;
  const name=prompt("薬の名前を変更してください。",med.name);
  if(name===null)return;
  const trimmed=name.trim();
  if(!trimmed)return;
  const dose=prompt("用量を変更してください。",med.dose||"");
  if(dose===null)return;
  const timing=prompt("服用タイミングを変更してください。",med.timing||"");
  if(timing===null)return;
  const note=prompt("メモを変更してください。",med.note||"");
  if(note===null)return;
  const payload=JSON.stringify({name:trimmed,dose:dose.trim(),timing:timing.trim(),note:note.trim()});
  const {error}=await supabaseClient.from("custom_rules").update({text:payload,source:note.trim()}).eq("id",med.id).eq("user_id",user.id).eq("category",MEDICATION_CATEGORY);
  if(error){setStatus("⚠️ 服薬の変更に失敗"); console.error(error); return;}
  state.medications=state.medications.map(x=>String(x.id)===String(id)?{...x,name:trimmed,dose:dose.trim(),timing:timing.trim(),note:note.trim()}:x);
  setStatus("☁️ 服薬を変更しました"); renderMedication();
}

async function deleteMedication(id){
  const med=state.medications.find(x=>String(x.id)===String(id));
  if(!med)return;
  if(!confirm(`「${med.name}」を削除しますか？\n\n服薬データとチェック履歴を削除します。`))return;
  const {error}=await supabaseClient.from("custom_rules").delete().eq("id",med.id).eq("user_id",user.id).eq("category",MEDICATION_CATEGORY);
  if(error){setStatus("⚠️ 服薬の削除に失敗"); console.error(error); return;}
  const {error:checkError}=await supabaseClient.from("daily_check_states").delete().eq("user_id",user.id).eq("item_id",`m:${med.id}`);
  if(checkError)console.warn(checkError);
  delete state.checks[`m:${med.id}`];
  state.medications=state.medications.filter(x=>String(x.id)!==String(id));
  setStatus("☁️ 服薬を削除しました"); renderMedication();
}

function renderMedication(){
  const wrap=document.getElementById("medicationList");
  if(!wrap)return;
  wrap.innerHTML="";
  if(!state.medications.length){
    const empty=document.createElement("p"); empty.className="muted small"; empty.textContent="登録されている薬はありません。"; wrap.appendChild(empty); return;
  }
  for(const med of state.medications){
    const row=document.createElement("div"); row.className="medication-row";
    const main=document.createElement("div"); main.className="medication-main";
    const title=document.createElement("strong"); title.textContent=med.name;
    const meta=document.createElement("div"); meta.className="medication-meta";
    if(med.dose)meta.append(document.createTextNode(med.dose));
    if(med.timing)meta.append(document.createTextNode((med.dose?"・":"")+med.timing));
    if(med.note)meta.append(document.createTextNode((med.dose||med.timing?"・":"")+med.note));
    main.append(title,meta);
    const check=document.createElement("label"); check.className="medication-taken";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=!!state.checks[`m:${med.id}`];
    const span=document.createElement("span"); span.textContent="服用済み";
    cb.onchange=async()=>{await saveCheck(`m:${med.id}`,cb.checked); renderMedication();};
    check.append(cb,span);
    if(cb.checked)row.classList.add("taken");
    const actions=document.createElement("div"); actions.className="rule-actions";
    const edit=document.createElement("button"); edit.type="button"; edit.className="edit-rule"; edit.textContent="変更"; edit.onclick=()=>editMedication(med.id);
    const del=document.createElement("button"); del.type="button"; del.className="delete-rule"; del.textContent="削除"; del.onclick=()=>deleteMedication(med.id);
    actions.append(edit,del);
    row.append(main,check,actions); wrap.appendChild(row);
  }
}


async function loadDailyParameters(){
  state.parameters={sleepHours:"",hallucinations:[],note:""};
  state.parameterRowId=null;
  const local=localStorage.getItem(`dailyParameters:${day()}`);
  if(local){
    try{ state.parameters=JSON.parse(local)||state.parameters; }catch{}
  }
  if(!supabaseReady||!user){ renderDailyParameters(); return; }
  const res=await supabaseClient.from("custom_rules").select("id,text,category")
    .eq("user_id",user.id).eq("category",DAILY_PARAMETER_CATEGORY).order("created_at",{ascending:false});
  if(res.error){console.error(res.error);renderDailyParameters();return;}
  for(const row of res.data||[]){
    try{
      const data=JSON.parse(row.text||"{}");
      if(data.date===day()){
        state.parameters={sleepHours:data.sleepHours??"",hallucinations:Array.isArray(data.hallucinations)?data.hallucinations:[],note:data.note??""};
        state.parameterRowId=row.id;
        break;
      }
    }catch{}
  }
  renderDailyParameters();
}

function renderDailyParameters(){
  const p=state.parameters||{};
  const sleep=document.getElementById("sleepHours");
  if(sleep)sleep.value=p.sleepHours??"";
  const checks={
    hallucinationVisual:"幻視",hallucinationAuditory:"幻聴",hallucinationTactile:"幻触",
    delusionPersecution:"被害妄想",hallucinationOther:"幻覚（その他）"
  };
  Object.entries(checks).forEach(([id,label])=>{
    const el=document.getElementById(id); if(el)el.checked=(p.hallucinations||[]).includes(label);
  });
  const note=document.getElementById("parameterNote"); if(note)note.value=p.note||"";
}

async function saveDailyParameters(){
  const sleep=document.getElementById("sleepHours")?.value.trim()||"";
  const hallucinations=[];
  const checks={
    hallucinationVisual:"幻視",hallucinationAuditory:"幻聴",hallucinationTactile:"幻触",
    delusionPersecution:"被害妄想",hallucinationOther:"幻覚（その他）"
  };
  Object.entries(checks).forEach(([id,label])=>{if(document.getElementById(id)?.checked)hallucinations.push(label);});
  const note=document.getElementById("parameterNote")?.value.trim()||"";
  if(sleep!=="" && (Number(sleep)<0 || Number(sleep)>24)){alert("睡眠時間は0〜24時間で入力してください。");return;}
  const data={date:day(),sleepHours:sleep,hallucinations,note};
  state.parameters={sleepHours:sleep,hallucinations,note};
  localStorage.setItem(`dailyParameters:${day()}`,JSON.stringify(data));
  if(!supabaseReady||!user){
    const st=document.getElementById("parameterStatus"); if(st)st.textContent="この端末に保存しました。ログインするとクラウド同期できます。";
    await loadParameterTrendHistory();
    return;
  }
  let rowId=state.parameterRowId;
  if(!rowId){
    const find=await supabaseClient.from("custom_rules").select("id,text").eq("user_id",user.id).eq("category",DAILY_PARAMETER_CATEGORY).order("created_at",{ascending:false});
    if(!find.error){
      for(const row of find.data||[]){
        try{ if(JSON.parse(row.text||"{}").date===day()){ rowId=row.id; break; } }catch{}
      }
    }
  }
  let error=null;
  if(rowId){
    const res=await supabaseClient.from("custom_rules").update({text:JSON.stringify(data)})
      .eq("id",rowId).eq("user_id",user.id).eq("category",DAILY_PARAMETER_CATEGORY);
    error=res.error;
  }else{
    const res=await supabaseClient.from("custom_rules").insert({user_id:user.id,text:JSON.stringify(data),category:DAILY_PARAMETER_CATEGORY}).select("id").single();
    error=res.error; if(res.data)state.parameterRowId=res.data.id;
  }
  if(error){console.error(error);alert(`保存に失敗しました：${error.message}`);return;}
  const st=document.getElementById("parameterStatus"); if(st)st.textContent="☁️ その他パラメーターを保存しました";
  await loadParameterTrendHistory();
}

async function loadCloud(){
  if(!supabaseReady||!user)return;
  await removeDeletedCategories();
  await ensureBaseRules();
  await ensureBasicRules();
  await ensureLifeRules();
  await ensureWorkRules();
  await ensureAdditionalWorkRules();
  await ensureMedicalRules();
  await ensurePriorityRules();
  const d=day();
  const {data,error}=await supabaseClient.from("daily_check_states")
    .select("item_id,checked").eq("user_id",user.id).eq("check_date",d);
  if(error){console.error(error); setStatus("⚠️ チェックの読み込みに失敗"); return;}
  state.checks={};
  for(const row of data||[]) state.checks[row.item_id]=row.checked;

  let cr=await supabaseClient.from("custom_rules").select("id,text,category,source").eq("user_id",user.id).order("created_at");
  if(cr.error && /source|column/i.test(cr.error.message||"")){
    cr=await supabaseClient.from("custom_rules").select("id,text,category").eq("user_id",user.id).order("created_at");
  }
  if(cr.error){console.error(cr.error); return;}
  const rows=cr.data||[];
  state.custom=rows
    .filter(x=>x.category!==BASE_SENTINEL_CATEGORY && x.text!==BASE_SENTINEL_TEXT && x.category!==PRIORITY_CATEGORY && x.category!==MEDICATION_CATEGORY)
    .map(x=>({id:x.id,text:x.text,cat:x.category,source:x.source||""}));
  state.priority=rows
    .filter(x=>x.category===PRIORITY_CATEGORY && x.text!==PRIORITY_SENTINEL_TEXT)
    .map(x=>({id:x.id,text:x.text}));
  state.medications=rows.filter(x=>x.category===MEDICATION_CATEGORY).map(parseMedicationRow);
  await loadDailyParameters();
  render();
  await loadAchievementHistory();
  await loadUrgeHistory(urgeChartDays);
}

async function saveCheck(itemId,checked){
  state.checks[itemId]=checked;
  if(!supabaseReady||!user)return;
  const {error}=await supabaseClient.from("daily_check_states").upsert({
    user_id:user.id,check_date:day(),item_id:itemId,checked
  },{onConflict:"user_id,check_date,item_id"});
  if(error){console.error(error); setStatus("⚠️ 保存失敗");}
}

async function updateAccountUI(){
  if(!user)return;
  const isAnon = user.is_anonymous === true;
  if(isAnon){
    accountStatus.textContent="匿名アカウントで利用中（この端末専用）";
    anonPanel.classList.remove("hidden");
    loggedInPanel.classList.add("hidden");
    signOutBtn.classList.add("hidden");
  }else{
    accountStatus.textContent=`ログイン中：${user.email || "メールアカウント"}`;
    anonPanel.classList.add("hidden");
    loggedInPanel.classList.remove("hidden");
    signOutBtn.classList.remove("hidden");
  }
}

async function ensureSession(){
  const {data,error}=await supabaseClient.auth.getSession();
  if(error) throw error;
  if(data.session){
    user=data.session.user;
  }else{
    const res=await supabaseClient.auth.signInAnonymously();
    if(res.error) throw res.error;
    user=res.data.user;
  }
  supabaseReady=true;
  setStatus("☁️ クラウド同期中");
  await updateAccountUI();
  await loadCloud();
  render();
}

async function migrateAnonymousDataTo(targetUserId, anonymousState){
  if(!anonymousState) return;

  // チェック済みだけを移行。既存アカウント側の未チェック状態を上書きしない。
  const checkedRows=Object.entries(anonymousState.checks||{})
    .filter(([,checked])=>checked)
    .map(([item_id])=>({
      user_id:targetUserId,
      check_date:day(),
      item_id,
      checked:true
    }));

  if(checkedRows.length){
    const {error}=await supabaseClient.from("daily_check_states")
      .upsert(checkedRows,{onConflict:"user_id,check_date,item_id"});
    if(error) throw error;
  }

  // 追加ルールは同じカテゴリ・本文が無いものだけ移行。
  for(const item of anonymousState.custom||[]){
    const {data:existing,error:findError}=await supabaseClient.from("custom_rules")
      .select("id").eq("user_id",targetUserId).eq("text",item.text).eq("category",item.cat).limit(1);
    if(findError) throw findError;
    if(!existing?.length){
      const {error}=await supabaseClient.from("custom_rules")
        .insert({user_id:targetUserId,text:item.text,category:item.cat});
      if(error) throw error;
    }
  }
}

async function loginExistingAccount(){
  const email=document.getElementById("loginEmail").value.trim();
  const password=document.getElementById("loginPassword").value;
  if(!email||!password){setAnonAuthMessage("メールアドレスとパスワードを入力してください。"); return;}

  const previousUser=user;
  const previousState={
    checks:{...state.checks},
    custom:[...(state.custom||[])]
  };

  setAnonAuthMessage("ログインしています…");
  const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
  if(error){
    setAnonAuthMessage(`ログインできませんでした：${error.message}`);
    return;
  }

  user=data.user;
  supabaseReady=true;
  setStatus("☁️ クラウド同期中");

  try{
    if(previousUser?.is_anonymous && previousUser.id!==user.id){
      await migrateAnonymousDataTo(user.id,previousState);
    }
    await updateAccountUI();
    await loadCloud();
    render();
    setAuthMessage("ログインしました。PC・スマホで同じデータを利用できます。");
    setAnonAuthMessage("");
  }catch(e){
    console.error(e);
    setAuthMessage(`ログイン後のデータ同期に失敗しました：${e.message}`);
  }
}

async function sendLoginPasswordReset(){
  const email=document.getElementById("loginEmail").value.trim();
  if(!email){setAnonAuthMessage("登録済みのメールアドレスを入力してください。"); return;}
  const redirectTo=window.location.href.split("#")[0];
  const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo});
  if(error){setAnonAuthMessage(`再設定メールを送れませんでした：${error.message}`); return;}
  setAnonAuthMessage("パスワード再設定メールを送りました。メールを確認してください。");
}

async function linkEmail(){
  const email=document.getElementById("linkEmail").value.trim();
  if(!email){alert("メールアドレスを入力してください。"); return;}
  const {error}=await supabaseClient.auth.updateUser({email});
  if(error){
    if(String(error.message||"").toLowerCase().includes("already been registered") || String(error.message||"").includes("already registered")){
      setAnonAuthMessage("このメールアドレスは既に登録されています。「すでにアカウントをお持ちの方」からログインしてください。");
    }else{
      setAnonAuthMessage(error.message);
    }
    return;
  }
  document.getElementById("passwordPanel").classList.remove("hidden");
  setAuthMessage("確認メールを送りました。メールの確認が完了してから、パスワードを設定してください。");
  accountStatus.textContent=`確認待ち：${email}`;
}

async function setPassword(){
  const password=document.getElementById("linkPassword").value;
  if(password.length<8){alert("パスワードは8文字以上にしてください。"); return;}
  const {error}=await supabaseClient.auth.updateUser({password});
  if(error){alert(error.message); return;}
  setAuthMessage("パスワードを設定しました。このアカウントで別のPC・スマホからログインできます。");
}

async function changePassword(){
  const newPassword=document.getElementById("newPassword").value;
  if(newPassword.length<8){setAuthMessage("新しいパスワードは8文字以上にしてください。"); return;}
  const {error}=await supabaseClient.auth.updateUser({password:newPassword});
  if(error){setAuthMessage(`パスワードを更新できませんでした：${error.message}`); return;}
  document.getElementById("newPassword").value="";
  document.getElementById("currentPassword").value="";
  setAuthMessage("パスワードを更新しました。");
}

async function sendPasswordReset(){
  if(!user?.email){setAuthMessage("登録メールアドレスが確認できません。"); return;}
  const redirectTo=window.location.href.split("#")[0];
  const {error}=await supabaseClient.auth.resetPasswordForEmail(user.email,{redirectTo});
  if(error){setAuthMessage(`再設定メールを送れませんでした：${error.message}`); return;}
  setAuthMessage("パスワード再設定メールを送りました。メールのリンクから新しいパスワードを設定してください。");
}

async function logout(){
  const {error}=await supabaseClient.auth.signOut();
  if(error){alert(error.message); return;}
  user=null; state={checks:{},custom:[],priority:[],medications:[]};
  setStatus("ログアウトしました");
  accountStatus.textContent="ログアウトしました。再ログインは次のログイン画面から行えます。";
  signOutBtn.classList.add("hidden");
}

async function addCustom(text,cat,source=""){
  if(!supabaseReady||!user){alert("Supabaseに接続できていません。"); return;}
  const {data,error}=await insertRuleRow(user.id,{text,cat,source});
  if(error){alert(`追加に失敗しました：${error.message}`); return;}
  state.custom.push({id:data.id,text:data.text,cat:data.category,source:data.source||source});
  render();
}

async function editRule(ruleId){
  if(!supabaseReady||!user){alert("Supabaseに接続できていません。"); return;}
  const rule=state.custom.find(x=>String(x.id)===String(ruleId));
  if(!rule)return;
  const text=prompt("ルール内容を変更してください。",rule.text);
  if(text===null)return;
  const newText=text.trim();
  if(!newText){alert("ルール内容を空にはできません。"); return;}
  const category=prompt("カテゴリを変更できます。",rule.cat);
  if(category===null)return;
  const newCategory=category.trim();
  if(!newCategory){alert("カテゴリを空にはできません。"); return;}
  const source=prompt("補足説明（不要なら空欄）",rule.source||"");
  if(source===null)return;

  let res=await supabaseClient.from("custom_rules").update({text:newText,category:newCategory,source:source.trim()})
    .eq("id",rule.id).eq("user_id",user.id);
  if(res.error && /source|column/i.test(res.error.message||"")){
    res=await supabaseClient.from("custom_rules").update({text:newText,category:newCategory})
      .eq("id",rule.id).eq("user_id",user.id);
  }
  if(res.error){alert(`変更に失敗しました：${res.error.message}`); return;}

  const oldItemId=`c:${rule.id}`;
  state.custom=state.custom.map(x=>String(x.id)===String(rule.id)
    ? {...x,text:newText,cat:newCategory,source:source.trim()} : x);
  // ルールIDは変えないのでチェック状態はそのまま維持されます。
  if(state.checks[oldItemId]) state.checks[oldItemId]=true;
  render();
  setStatus("☁️ ルールを変更しました");
}

async function updateRuleSource(ruleId,source){
  const rule=state.custom.find(x=>String(x.id)===String(ruleId));
  if(!rule||!supabaseReady||!user)return;
  let res=await supabaseClient.from("custom_rules").update({source:source.trim()}).eq("id",rule.id).eq("user_id",user.id);
  if(res.error && /source|column/i.test(res.error.message||"")) return;
  if(res.error){alert(`補足の保存に失敗しました：${res.error.message}`);return;}
  rule.source=source.trim();
  setStatus("☁️ 頓服の補足を保存しました");
}

async function deleteRule(ruleId){
  if(!supabaseReady||!user){alert("Supabaseに接続できていません。"); return;}
  const rule=state.custom.find(x=>String(x.id)===String(ruleId));
  if(!rule)return;
  if(!confirm(`「${rule.text}」を削除しますか？\n\nこのルールはアカウントから削除されます。`))return;

  const {error}=await supabaseClient.from("custom_rules")
    .delete().eq("id",rule.id).eq("user_id",user.id);
  if(error){alert(`削除に失敗しました：${error.message}`); return;}

  const cleanup=await supabaseClient.from("daily_check_states")
    .delete().eq("user_id",user.id).eq("item_id",`c:${rule.id}`);
  if(cleanup.error) console.warn("チェック状態の削除に失敗しました：",cleanup.error);

  delete state.checks[`c:${rule.id}`];
  state.custom=state.custom.filter(x=>String(x.id)!==String(rule.id));
  render();
  setStatus("☁️ ルールを削除しました");
}

async function addPriority(text){
  if(!supabaseReady||!user){alert("Supabaseに接続できていません。"); return;}
  const newText=text.trim();
  if(!newText)return;
  const {data,error}=await insertRuleRow(user.id,{text:newText,cat:PRIORITY_CATEGORY,source:""});
  if(error){alert(`追加に失敗しました：${error.message}`); return;}
  state.priority.push({id:data.id,text:data.text});
  render();
  setStatus("☁️ 最優先を追加しました");
}

async function editPriority(ruleId){
  if(!supabaseReady||!user){alert("Supabaseに接続できていません。"); return;}
  const rule=state.priority.find(x=>String(x.id)===String(ruleId));
  if(!rule)return;
  const text=prompt("最優先の内容を変更してください。",rule.text);
  if(text===null)return;
  const newText=text.trim();
  if(!newText){alert("内容を空にはできません。"); return;}
  const {error}=await supabaseClient.from("custom_rules")
    .update({text:newText}).eq("id",rule.id).eq("user_id",user.id).eq("category",PRIORITY_CATEGORY);
  if(error){alert(`変更に失敗しました：${error.message}`); return;}
  state.priority=state.priority.map(x=>String(x.id)===String(rule.id)?{...x,text:newText}:x);
  render();
  setStatus("☁️ 最優先を変更しました");
}

async function deletePriority(ruleId){
  if(!supabaseReady||!user){alert("Supabaseに接続できていません。"); return;}
  const rule=state.priority.find(x=>String(x.id)===String(ruleId));
  if(!rule)return;
  if(!confirm(`「${rule.text}」を削除しますか？\n\nこの最優先項目はアカウントから削除されます。`))return;
  const {error}=await supabaseClient.from("custom_rules")
    .delete().eq("id",rule.id).eq("user_id",user.id).eq("category",PRIORITY_CATEGORY);
  if(error){alert(`削除に失敗しました：${error.message}`); return;}
  state.priority=state.priority.filter(x=>String(x.id)!==String(rule.id));
  render();
  setStatus("☁️ 最優先を削除しました");
}

function getUrgeLevel(type){
  for(let level=0;level<=10;level++){
    if(state.checks[`urge:${type}:${level}`]) return level;
  }
  return null;
}

function setUrgeDraft(type, level){
  const previous=getUrgeLevel(type);
  if(previous!==null) delete state.checks[`urge:${type}:${previous}`];
  state.checks[`urge:${type}:${level}`]=true;
}

let urgeChartDays=7;
function renderUrgeChart(points){
  const chart=document.getElementById("urgeChart");
  if(!chart)return;
  chart.innerHTML="";
  const showEvery=points.length>10?5:1;
  for(let i=0;i<points.length;i++){
    const point=points[i]||{};
    const col=document.createElement("div"); col.className="urge-chart-col";
    const bars=document.createElement("div"); bars.className="urge-bars";
    URGE_TYPES.forEach(type=>{
      const raw=point[type.id];
      const n=(raw===null||raw===undefined||raw==="")?null:Number(raw);
      const bar=document.createElement("div");
      bar.className=`urge-bar ${type.id}-bar`;
      bar.style.height=n!==null && Number.isFinite(n)?`${Math.max(0,Math.min(10,n))*10}%`:'2%';
      bar.title=`${type.label}: ${n===null?'未記録':n+' / 10'}`;
      if(n===null) bar.classList.add("unrecorded");
      bars.appendChild(bar);
    });
    const label=document.createElement("span"); label.className="urge-chart-label"; label.textContent=(i%showEvery===0||i===points.length-1)?shortDate(point.date):"";
    col.append(bars,label); chart.appendChild(col);
  }
}

function renderParameterTrend(points){
  const chart=document.getElementById("parameterTrendChart");
  if(!chart)return;
  chart.innerHTML="";
  const maxSleep=24;
  const maxSymptoms=5;
  const showEvery=points.length>10?5:1;
  for(let i=0;i<points.length;i++){
    const p=points[i];
    const col=document.createElement("div"); col.className="parameter-trend-col";
    const bars=document.createElement("div"); bars.className="parameter-trend-bars";
    const sleep=document.createElement("div"); sleep.className="parameter-bar sleep-bar"; sleep.style.height=`${Math.max((Number(p.sleep)||0)/maxSleep*100,2)}%`; sleep.title=`睡眠 ${p.sleep==null?"未記録":p.sleep+"時間"}`;
    const symptoms=document.createElement("div"); symptoms.className="parameter-bar symptom-bar"; symptoms.style.height=`${Math.max((Number(p.symptoms)||0)/maxSymptoms*100,2)}%`; symptoms.title=`症状 ${p.symptoms??0}項目`;
    bars.append(sleep,symptoms);
    const label=document.createElement("span"); label.className="parameter-trend-label"; label.textContent=(i%showEvery===0||i===points.length-1)?shortDate(p.date):"";
    col.append(bars,label); chart.appendChild(col);
  }
}
async function loadParameterTrendHistory(days=urgeChartDays){
  const chart=document.getElementById("parameterTrendChart"); if(!chart)return;
  const dates=Array.from({length:days},(_,i)=>dateOffset(i-days+1));
  const empty=dates.map(date=>({date,sleep:null,symptoms:0}));
  if(!supabaseReady||!user){
    const today=state.parameters||{};
    const point=empty[empty.length-1];
    if(today.sleepHours!=="")point.sleep=Number(today.sleepHours);
    point.symptoms=(today.hallucinations||[]).length;
    renderParameterTrend(empty); return;
  }
  const {data,error}=await supabaseClient.from("custom_rules").select("id,text,category")
    .eq("user_id",user.id).eq("category",DAILY_PARAMETER_CATEGORY).order("created_at");
  if(error){console.error(error);return;}
  const byDate={};
  for(const row of data||[]){
    try{
      const d=JSON.parse(row.text||"{}");
      if(!dates.includes(d.date))continue;
      byDate[d.date]={date:d.date,sleep:d.sleepHours===""||d.sleepHours==null?null:Number(d.sleepHours),symptoms:Array.isArray(d.hallucinations)?d.hallucinations.length:0};
    }catch{}
  }
  const points=dates.map(date=>byDate[date]||{date,sleep:null,symptoms:0});
  renderParameterTrend(points);
}

async function loadUrgeHistory(days=urgeChartDays){
  urgeChartDays=days;
  const chart=document.getElementById("urgeChart"), note=document.getElementById("urgeChartNote");
  if(!chart)return;
  const dates=Array.from({length:days},(_,i)=>dateOffset(i-days+1));
  const empty=()=>{const x={date:null}; URGE_TYPES.forEach(t=>x[t.id]=null); return x;};

  const byDate={};
  for(const date of dates){
    const raw=localStorage.getItem(`mentalState:${date}`);
    if(raw){try{byDate[date]={...(byDate[date]||{}),...JSON.parse(raw)}}catch{}}
  }

  const draftRaw=localStorage.getItem("mentalState:draft");
  if(draftRaw){try{const draft=JSON.parse(draftRaw); if(draft.date && dates.includes(draft.date)) byDate[draft.date]={...(byDate[draft.date]||{}),...draft};}catch{}}

  if(supabaseReady&&user){
    try{
      const {data,error}=await supabaseClient.from("custom_rules")
        .select("id,text,category").eq("user_id",user.id).eq("category",DAILY_MENTAL_CATEGORY).order("created_at");
      if(!error){
        for(const row of data||[]){
          try{
            const d=JSON.parse(row.text||"{}");
            if(d.date && dates.includes(d.date)) byDate[d.date]={...(byDate[d.date]||{}),...d};
          }catch{}
        }
      } else {
        console.warn("心の状態のクラウド履歴を取得できません。ローカル履歴を使用します。",error);
      }
    }catch(e){
      console.warn("心の状態のクラウド履歴取得失敗",e);
    }
  }

  const points=dates.map(date=>({...empty(),date,...(byDate[date]||{})}));
  renderUrgeChart(points);
  await loadParameterTrendHistory(days);
  if(note){
    const savedDates=dates.filter(d=>byDate[d] && URGE_TYPES.some(t=>byDate[d][t.id]!==null && byDate[d][t.id]!==undefined)).length;
    note.textContent=`過去${days}日間の保存済み心の状態：${savedDates}日分。保存前の入力は当日のグラフに即時反映されます。`;
  }
}

function initUrgeChartTabs(){
  document.querySelectorAll(".urge-tab").forEach(btn=>btn.addEventListener("click",async()=>{
    document.querySelectorAll(".urge-tab").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    await loadUrgeHistory(Number(btn.dataset.days));
  }));
}

async function saveUrges(){
  const status=document.getElementById("urgeSaveStatus");
  const values={date:day()};
  let hasValue=false;
  for(const type of URGE_TYPES){
    const el=document.getElementById(`urge-${type.id}`);
    const value=el && el.value!=="" ? Number(el.value) : null;
    values[type.id]=value;
    if(value!==null)hasValue=true;
  }
  if(!hasValue){ if(status)status.textContent="保存する項目を1つ以上選択してください。"; return; }

  // まず端末に保存。これを推移グラフの一次データとして使用する。
  localStorage.setItem(`mentalState:${day()}`,JSON.stringify(values));
  localStorage.removeItem("mentalState:draft");

  // 現在画面の選択状態も更新（達成率には含めない）
  for(const type of URGE_TYPES){
    const value=values[type.id];
    for(let level=0; level<=10; level++) delete state.checks[`urge:${type.id}:${level}`];
    if(value!==null) state.checks[`urge:${type.id}:${value}`]=true;
  }

  let cloudSaved=false;
  if(supabaseReady&&user){
    try{
      const find=await supabaseClient.from("custom_rules").select("id,text,category")
        .eq("user_id",user.id).eq("category",DAILY_MENTAL_CATEGORY);
      if(!find.error){
        let rowId=null;
        for(const row of find.data||[]){
          try{if(JSON.parse(row.text||"{}").date===day()){rowId=row.id;break;}}catch{}
        }
        const res=rowId
          ? await supabaseClient.from("custom_rules").update({text:JSON.stringify(values)}).eq("id",rowId).eq("user_id",user.id).eq("category",DAILY_MENTAL_CATEGORY)
          : await supabaseClient.from("custom_rules").insert({user_id:user.id,text:JSON.stringify(values),category:DAILY_MENTAL_CATEGORY});
        cloudSaved=!res.error;
        if(res.error) console.warn("心の状態のクラウド保存失敗（端末には保存済み）",res.error);
      }
    }catch(e){ console.warn("心の状態のクラウド保存失敗（端末には保存済み）",e); }
  }

  if(status)status.textContent=cloudSaved?"☁️ 心の状態を保存しました":"💾 この端末に心の状態を保存しました";
  renderUrges();
  await loadUrgeHistory(urgeChartDays);
}

function renderUrges(){
  const wrap=document.getElementById("urgeLevels");
  if(!wrap)return;
  wrap.innerHTML="";
  for(const type of URGE_TYPES){
    const row=document.createElement("div"); row.className="urge-row";
    const label=document.createElement("label"); label.textContent=type.label; label.setAttribute("for",`urge-${type.id}`);
    const select=document.createElement("select"); select.id=`urge-${type.id}`; select.setAttribute("aria-label",`${type.label}の10段階評価`);
    const placeholder=document.createElement("option"); placeholder.value=""; placeholder.textContent="選択してください"; select.appendChild(placeholder);
    for(let level=0;level<=10;level++){
      const option=document.createElement("option"); option.value=String(level); option.textContent=`${level} / 10`; select.appendChild(option);
    }
    const current=getUrgeLevel(type.id);
    if(current!==null) select.value=String(current);
    select.onchange=()=>{
      const value=select.value===""?null:Number(select.value);
      for(let level=0;level<=10;level++) delete state.checks[`urge:${type.id}:${level}`];
      if(value!==null) state.checks[`urge:${type.id}:${value}`]=true;
      const draft={date:day()};
      for(const t of URGE_TYPES){
        const el2=document.getElementById(`urge-${t.id}`);
        draft[t.id]=(el2&&el2.value!=="")?Number(el2.value):null;
      }
      localStorage.setItem(`mentalState:draft`,JSON.stringify(draft));
      loadUrgeHistory(urgeChartDays);
    };
    row.append(label,select); wrap.appendChild(row);
  }
}

function renderPriority(){
  const wrap=document.getElementById("priorityList");
  if(!wrap)return;
  wrap.innerHTML="";
  const items=priorityItems();
  items.forEach((item,index)=>{
    const row=document.createElement("div");
    row.className="priority-row";
    const text=document.createElement("span");
    text.textContent=`${index+1}. ${item.text}`;
    const actions=document.createElement("div");
    actions.className="rule-actions";
    const edit=document.createElement("button");
    edit.type="button"; edit.className="edit-rule"; edit.textContent="変更";
    edit.onclick=async()=>editPriority(item.id);
    const del=document.createElement("button");
    del.type="button"; del.className="delete-rule"; del.textContent="削除";
    del.onclick=async()=>deletePriority(item.id);
    actions.append(edit,del);
    row.append(text,actions);
    wrap.appendChild(row);
    if(index<items.length-1){
      const arrow=document.createElement("span");
      arrow.className="priority-arrow";
      arrow.textContent="→";
      wrap.appendChild(arrow);
    }
  });
}

function updateProgress(){
  const items=allItems().filter(x=>x.trackAchievement!==false), done=items.filter(x=>state.checks[x.id]).length;
  const rate=items.length ? Math.round(done/items.length*100) : 0;
  document.getElementById("progressText").textContent=`${done} / ${items.length}（${rate}%）`;
  document.getElementById("progressBar").style.width=rate+"%";
  const summary=document.getElementById("achievementSummary");
  if(summary) summary.textContent=`達成率 ${rate}%　・　${done}項目達成 / ${items.length}項目`;
}

function dateOffset(offset){
  const d=new Date(); d.setDate(d.getDate()+offset);
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
function shortDate(iso){
  const [y,m,d]=iso.split("-"); return `${Number(m)}/${Number(d)}`;
}
async function loadAchievementHistory(){
  const chart=document.getElementById("achievementChart");
  const note=document.getElementById("chartNote");
  if(!chart)return;
  const dates=Array.from({length:7},(_,i)=>dateOffset(i-6));
  const total=allItems().filter(x=>x.trackAchievement!==false).length;
  if(!supabaseReady||!user||!total){
    renderAchievementChart(dates.map(date=>({date,rate:0,done:0})));
    if(note) note.textContent=total?"ログインすると過去7日間の達成率を表示できます。":"ルールや服薬を登録すると達成率を表示できます。";
    return;
  }
  const {data,error}=await supabaseClient.from("daily_check_states")
    .select("check_date,item_id,checked").eq("user_id",user.id).gte("check_date",dates[0]).lte("check_date",dates[6]);
  if(error){console.error(error); if(note) note.textContent="グラフデータを読み込めませんでした。"; return;}
  const eligibleIds=new Set(allItems().filter(x=>x.trackAchievement!==false).map(x=>x.id));
  const byDate={};
  for(const row of data||[]) if(row.checked && eligibleIds.has(row.item_id)){(byDate[row.check_date]??=[]).push(row.item_id);}
  const points=dates.map(date=>{
    const done=new Set(byDate[date]||[]).size;
    return {date,done,rate:Math.min(100,Math.round(done/total*100))};
  });
  renderAchievementChart(points);
  if(note) note.textContent=`現在の${total}項目を基準に、直近7日間の達成率を表示しています。`;
}
function renderAchievementChart(points){
  const chart=document.getElementById("achievementChart"); if(!chart)return;
  chart.innerHTML="";
  for(const point of points){
    const col=document.createElement("div"); col.className="chart-col";
    const value=document.createElement("span"); value.className="chart-value"; value.textContent=`${point.rate}%`;
    const track=document.createElement("div"); track.className="chart-track";
    const bar=document.createElement("div"); bar.className="chart-bar"; bar.style.height=`${Math.max(point.rate,2)}%`; track.appendChild(bar);
    const label=document.createElement("span"); label.className="chart-label"; label.textContent=shortDate(point.date);
    col.append(value,track,label); chart.appendChild(col);
  }
}

function render(){
  refreshCategoryOptions();
  renderPriority();
  renderUrges();
  renderDailyParameters();
  renderMedication();
  const wrap=document.getElementById("categories"); wrap.innerHTML="";
  const groups={};
  for(const item of allItems()) (groups[item.cat]??=[]).push(item);

  const groupDefs=[
    {name:"基本",icon:"📌",cats:["基本"]},
    {name:"生活",icon:"🏠",cats:["生活"]},
    {name:"職場",icon:"💼",cats:["職場"]},
    {name:"今日の振り返り",icon:"📝",cats:["今日の振り返り"]},
    {name:"通院",icon:"🏥",cats:["通院"]}
  ];
  // 自由入力で追加されたカテゴリーも「その他」にまとめず、独立したグループとして表示
  const fixedCats=new Set(groupDefs.flatMap(g=>g.cats));
  for(const cat of Object.keys(groups)){
    if(!fixedCats.has(cat) && !["__priority__","__medication__","__daily_parameters__"].includes(cat)){
      groupDefs.push({name:cat,icon:"📂",cats:[cat]});
    }
  }
  const used=new Set();
  const renderRule=(item)=>{
    const label=document.createElement("div"); label.className="check";
    const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=!!state.checks[item.id];
    const div=document.createElement("div"); div.className="text"; div.textContent=item.text;
    if(item.source && item.text!=="頓服を飲んだ"){const src=document.createElement("small"); src.className="source"; src.textContent=`補足：${item.source}`; div.appendChild(src);}
    if(item.text==="頓服を飲んだ"){
      const note=document.createElement("input"); note.type="text"; note.className="rule-inline-note"; note.placeholder="補足（任意）"; note.maxLength=300; note.value=item.source||"";
      note.onclick=e=>e.stopPropagation();
      note.onchange=async()=>{ await updateRuleSource(item.id.slice(2),note.value); };
      div.appendChild(note);
    }
    if(cb.checked) label.classList.add("done");
    cb.onchange=async()=>{label.classList.toggle("done",cb.checked); await saveCheck(item.id,cb.checked); updateProgress();};
    label.append(cb,div);
    const actions=document.createElement("div"); actions.className="rule-actions";
    const edit=document.createElement("button"); edit.type="button"; edit.className="edit-rule"; edit.textContent="変更";
    edit.onclick=async(e)=>{e.preventDefault();e.stopPropagation();await editRule(item.id.slice(2));};
    const del=document.createElement("button"); del.type="button"; del.className="delete-rule"; del.textContent="削除";
    del.onclick=async(e)=>{e.preventDefault();e.stopPropagation();await deleteRule(item.id.slice(2));};
    actions.append(edit,del); label.appendChild(actions);
    return label;
  };
  for(const group of groupDefs){
    const items=[];
    for(const cat of group.cats){ if(groups[cat]){items.push(...groups[cat]);used.add(cat);} }
    if(!items.length) continue;
    const sec=document.createElement("section"); sec.className="card category rule-group";
    sec.innerHTML=`<div class="group-title"><h2>${group.icon} ${group.name}</h2><span class="group-count">${items.length}項目</span></div>`;
    items.forEach(item=>sec.appendChild(renderRule(item)));
    wrap.appendChild(sec);
  }

  updateProgress();
}
// タブ切り替え：今日のチェックシートにルール一覧とルール追加を集約
const checksheetTab=document.getElementById("checksheetTab");
const recordTab=document.getElementById("recordTab");
const categoriesEl=document.getElementById("categories");
const addRulesEl=document.querySelector("section.add");
if(checksheetTab && categoriesEl && addRulesEl){
  checksheetTab.appendChild(categoriesEl);
  checksheetTab.appendChild(addRulesEl);
}
function switchAppTab(name){
  document.querySelectorAll(".app-tab").forEach(btn=>btn.classList.toggle("active",btn.dataset.tab===name));
  checksheetTab?.classList.toggle("active",name==="checksheet");
  recordTab?.classList.toggle("active",name==="record");
}
document.querySelectorAll(".app-tab").forEach(btn=>btn.addEventListener("click",()=>switchAppTab(btn.dataset.tab)));
switchAppTab("record");
const checksheetDate=document.getElementById("checksheetDate");
if(checksheetDate) checksheetDate.textContent=new Intl.DateTimeFormat("ja-JP",{dateStyle:"full"}).format(new Date());
function refreshCategoryOptions(){
  const select=document.getElementById("newCategory"); if(!select)return;
  const current=select.value;
  const names=["基本","生活","職場","今日の振り返り","通院",...(state.custom||[]).map(x=>x.cat)];
  const unique=[...new Set(names)].filter(x=>x && !["__custom__","__system__","__priority__","__medication__","__daily_parameters__"].includes(x));
  select.innerHTML=unique.map(x=>`<option value="${x.replaceAll('"','&quot;')}">${x}</option>`).join("")+`<option value="__custom__">✏️ 自由入力</option>`;
  if([...select.options].some(o=>o.value===current)) select.value=current;
}

document.getElementById("date").textContent=new Intl.DateTimeFormat("ja-JP",{dateStyle:"full"}).format(new Date());
initUrgeChartTabs();


document.getElementById("addMedicationBtn").onclick=async()=>{
  const name=document.getElementById("newMedicationName").value.trim();
  if(!name){alert("薬の名前を入力してください。");return;}
  await addMedication({
    name,
    dose:document.getElementById("newMedicationDose").value.trim(),
    timing:document.getElementById("newMedicationTiming").value.trim(),
    note:document.getElementById("newMedicationNote").value.trim()
  });
  ["newMedicationName","newMedicationDose","newMedicationTiming","newMedicationNote"].forEach(id=>document.getElementById(id).value="");
};

document.getElementById("addPriorityBtn").onclick=async()=>{
  const input=document.getElementById("newPriorityText");
  const text=input.value.trim();
  if(!text)return;
  await addPriority(text);
  input.value="";
};

const categorySelect=document.getElementById("newCategory");
const categoryCustom=document.getElementById("newCategoryCustom");
categorySelect.onchange=()=>{
  const custom=categorySelect.value==="__custom__";
  categoryCustom.style.display=custom?"block":"none";
  if(custom) categoryCustom.focus();
};
categoryCustom.addEventListener("keydown",e=>{
  if(e.key==="Enter") document.getElementById("addBtn").click();
});

document.getElementById("addBtn").onclick=async()=>{
  const input=document.getElementById("newText"), text=input.value.trim();
  if(!text)return;
  let category=categorySelect.value;
  if(category==="__custom__"){
    category=categoryCustom.value.trim();
    if(!category){alert("自由なカテゴリー名を入力してください。");categoryCustom.focus();return;}
  }
  const source=document.getElementById("newSource")?.value.trim()||"";
  await addCustom(text,category,source);
  input.value="";
  const sourceInput=document.getElementById("newSource"); if(sourceInput)sourceInput.value="";
  if(categorySelect.value==="__custom__"){
    let option=[...categorySelect.options].find(o=>o.value===category);
    if(!option){option=document.createElement("option");option.value=category;option.textContent=category;categorySelect.insertBefore(option,categorySelect.querySelector('option[value="__custom__"]'));}
    categorySelect.value=category;
    categoryCustom.value="";
    categoryCustom.style.display="none";
  }
};

document.getElementById("saveParametersBtn").onclick=saveDailyParameters;
document.getElementById("saveUrgesBtn").onclick=saveUrges;
document.getElementById("printBtn").onclick=()=>window.print();

document.getElementById("resetBtn").onclick=async()=>{
  if(!confirm("今日のチェックをすべて未チェックにしますか？"))return;
  for(const item of allItems()) await saveCheck(item.id,false);
  render();
};

document.getElementById("linkEmailBtn").onclick=linkEmail;
document.getElementById("setPasswordBtn").onclick=setPassword;
document.getElementById("loginBtn").onclick=loginExistingAccount;
document.getElementById("loginResetBtn").onclick=sendLoginPasswordReset;
document.getElementById("changePasswordBtn").onclick=changePassword;
document.getElementById("resetPasswordBtn").onclick=sendPasswordReset;
document.getElementById("signOutBtn").onclick=logout;

supabaseClient.auth.onAuthStateChange(async (_event, session)=>{
  if(session){
    user=session.user; supabaseReady=true;
    setStatus("☁️ クラウド同期中");
    await updateAccountUI();
  }
});

(async()=>{
  try{
    await ensureSession();
  }catch(e){
    console.error(e);
    setStatus("⚠️ Supabase接続エラー");
    accountStatus.textContent=e.message;
    render();
  }
})();
