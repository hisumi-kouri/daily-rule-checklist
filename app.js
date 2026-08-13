import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://nhyikuzvigfzrcgetxej.supabase.co";
const SUPABASE_KEY = "sb_publishable_WrbDksID8cIESwNpSX5AkQ_Z3hHSSAG";
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

const base=[
["生活",[
["睡眠薬を毎日飲む","須摩さん"],
["遅刻した時は午後から出勤してもよい（毎日遅刻にならないよう注意）","須摩さん"],
["人が通る道などの犬のふんは掃除する","須摩さん"],
["高松さんへ週1回メールを送る","須摩さん"]
]],
["職場・基本ルール",[
["指示を受けたら、覚えているうちにチャッピーへ送る","須摩さん"],
["利用者へ直接指示しない","須摩さん"],
["利用者へ伝えたいことは必ず職員を通す","須摩さん"],
["再撮影の報告はメモをして、まとめて職員へ伝える","須摩さん"],
["緊急性のない質問はチャットワークで","石川さん"],
["急ぎではない連絡は、その場ですぐ対応しなくてもよい","石川さん"],
["個人面談中はチャットワークを送らない","石川さん"],
["勝手に判断せず、迷ったら職員へ確認する","石川さん"],
["ミスのフィードバックはすぐにする","石川さん"],
["外界の音が気になる時はイヤフォンを使ってよい","石川さん"]
]],
["出品ルール",[
["miniプリンターの管理番号はM00233（旧M00227）","石川さん"],
["同じ商品は「状態A」「状態B」などで区別する","安井さん・須摩さん"],
["分からないものは飛ばして、出品できるものから進める","石川さん"],
["質問するときは具体的な数を言ってから、どのくらいかを聞く","石川さん"],
["3回再出品してから値下げする","石川さん"]
]],
["リタリコブログ",[
["まず自分で文章を打つ","石川さん"],
["文章をチャッピーに整えてもらう","石川さん"],
["整えた文章を職員に見せる","石川さん"],
["改行・画像挿入を行う","石川さん"]
]],
["今日の確認",[
["体調 → 生活 → 仕事の順番を守った","きくながさん"],
["困った時に勝手に判断しなかった",""],
["今日も一日お疲れさまでした",""]
]]
];

let supabaseReady=false, user=null;
let state={checks:{}, custom:[]};
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

function allItems(){
  const arr=[];
  for(const [cat,items] of base) for(const [text,source] of items) arr.push({cat,text,source,id:"b:"+cat+":"+text});
  for(const x of state.custom) arr.push({...x,id:"c:"+x.id});
  return arr;
}

async function loadCloud(){
  if(!supabaseReady||!user)return;
  const d=day();
  const {data,error}=await supabaseClient.from("daily_check_states")
    .select("item_id,checked").eq("user_id",user.id).eq("check_date",d);
  if(error){console.error(error); setStatus("⚠️ チェックの読み込みに失敗"); return;}
  state.checks={};
  for(const row of data||[]) state.checks[row.item_id]=row.checked;

  const cr=await supabaseClient.from("custom_rules").select("id,text,category").eq("user_id",user.id).order("created_at");
  if(cr.error){console.error(cr.error); return;}
  state.custom=(cr.data||[]).map(x=>({id:x.id,text:x.text,cat:x.category}));
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
  user=null; state={checks:{},custom:[]};
  setStatus("ログアウトしました");
  accountStatus.textContent="ログアウトしました。再ログインは次のログイン画面から行えます。";
  signOutBtn.classList.add("hidden");
}

async function addCustom(text,cat){
  if(!supabaseReady||!user){alert("Supabaseに接続できていません。"); return;}
  const {data,error}=await supabaseClient.from("custom_rules")
    .insert({user_id:user.id,text,category:cat}).select().single();
  if(error){alert(`追加に失敗しました：${error.message}`); return;}
  state.custom.push({id:data.id,text:data.text,cat:data.category}); render();
}

function updateProgress(){
  const items=allItems(), done=items.filter(x=>state.checks[x.id]).length;
  document.getElementById("progressText").textContent=`${done} / ${items.length}`;
  document.getElementById("progressBar").style.width=(done/items.length*100)+"%";
}

function render(){
  const wrap=document.getElementById("categories"); wrap.innerHTML="";
  const groups={};
  for(const [cat,items] of base) groups[cat]=items.map(([text,source])=>({text,source,id:"b:"+cat+":"+text}));
  for(const x of state.custom){(groups[x.cat]??=[]).push({text:x.text,source:"追加",id:"c:"+x.id});}
  for(const [cat,items] of Object.entries(groups)){
    const sec=document.createElement("section"); sec.className="card category";
    sec.innerHTML=`<h2>${cat==="生活"?"🏠":cat==="職場・基本ルール"?"💼":cat==="出品ルール"?"📦":cat==="リタリコブログ"?"📝":"⭐"} ${cat}</h2>`;
    for(const item of items){
      const label=document.createElement("label"); label.className="check";
      const cb=document.createElement("input"); cb.type="checkbox"; cb.checked=!!state.checks[item.id];
      const div=document.createElement("div"); div.className="text"; div.textContent=item.text;
      if(item.source){const s=document.createElement("small"); s.className="source"; s.textContent=`（${item.source}）`; div.appendChild(s);}
      if(cb.checked) label.classList.add("done");
      cb.onchange=async()=>{label.classList.toggle("done",cb.checked); await saveCheck(item.id,cb.checked); updateProgress();};
      label.append(cb,div); sec.appendChild(label);
    }
    wrap.appendChild(sec);
  }
  updateProgress();
}

document.getElementById("date").textContent=new Intl.DateTimeFormat("ja-JP",{dateStyle:"full"}).format(new Date());

document.getElementById("addBtn").onclick=async()=>{
  const input=document.getElementById("newText"), text=input.value.trim();
  if(!text)return;
  await addCustom(text,document.getElementById("newCategory").value);
  input.value="";
};

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
