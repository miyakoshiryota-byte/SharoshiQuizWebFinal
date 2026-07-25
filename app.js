const APP_VERSION="4.0";
const state={
  allQuestions:[],session:[],index:0,correct:0,wrongIds:[],answered:false,
  activeBlank:null,selectionAnswers:{},selectionOptions:[],
  mode:"practice",responses:[],timerId:null,endAt:null
};
const $=id=>document.getElementById(id);
const screens=["home","quiz","result"];

function showScreen(name){
  screens.forEach(id=>$(id).classList.toggle("active",id===name));
}
function shuffle(a){
  const r=[...a];
  for(let i=r.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [r[i],r[j]]=[r[j],r[i]];
  }
  return r;
}
function getStats(){
  return JSON.parse(localStorage.getItem("sharoshi-stats")||'{"total":0,"correct":0,"today":0,"date":"","subjects":{},"questions":{}}');
}
function saveStats(ok,q){
  const d=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Tokyo"}).format(new Date()),s=getStats();
  if(s.date!==d){s.date=d;s.today=0}
  s.subjects=s.subjects||{};
  s.questions=s.questions||{};
  s.total++;s.today++;
  if(ok)s.correct++;

  const subject=s.subjects[q.subject]||{total:0,correct:0};
  subject.total++;
  if(ok)subject.correct++;
  s.subjects[q.subject]=subject;

  const question=s.questions[q.id]||{total:0,correct:0,lastWrong:false};
  question.total++;
  if(ok)question.correct++;
  question.lastWrong=!ok;
  s.questions[q.id]=question;

  localStorage.setItem("sharoshi-stats",JSON.stringify(s));
  renderStats();
}
function renderStats(){
  const s=getStats();
  $("todayCount").textContent=s.today||0;
  $("totalCount").textContent=s.total||0;
  $("accuracy").textContent=s.total?Math.round(s.correct/s.total*100)+"%":"–";
  renderSubjectStats();
}
function renderSubjectStats(){
  const s=getStats(),subjects=s.subjects||{};
  const rows=Object.entries(subjects)
    .sort((a,b)=>(a[1].correct/a[1].total)-(b[1].correct/b[1].total));
  if(!rows.length){
    $("subjectStats").innerHTML='<p class="empty-message">まだ解答履歴がありません。</p>';
    return;
  }
  $("subjectStats").innerHTML=rows.map(([name,v])=>{
    const rate=Math.round(v.correct/v.total*100);
    return `<div class="subject-stat-row">
      <div class="subject-stat-head">
        <strong>${name}</strong><span>${v.correct}/${v.total}問・${rate}%</span>
      </div>
      <div class="stat-track"><div class="stat-fill" style="width:${rate}%"></div></div>
    </div>`;
  }).join("");
}
function questionWeakness(q){
  const qs=(getStats().questions||{})[q.id];
  if(!qs)return 1000;
  const rate=qs.total?qs.correct/qs.total:0;
  return (qs.lastWrong?500:0)+(1-rate)*100+Math.min(qs.total,10);
}
function getFavorites(){
  return new Set(JSON.parse(localStorage.getItem("sharoshi-favorites")||"[]"));
}
function toggleFavorite(){
  const q=state.session[state.index],f=getFavorites();
  f.has(q.id)?f.delete(q.id):f.add(q.id);
  localStorage.setItem("sharoshi-favorites",JSON.stringify([...f]));
  renderFavorite();
}
function renderFavorite(){
  const q=state.session[state.index];
  $("favoriteButton").textContent=getFavorites().has(q.id)?"★":"☆";
}
function buildSubjects(){
  const s=[...new Set(state.allQuestions.map(q=>q.subject))];
  const tf=state.allQuestions.filter(q=>q.type==="trueFalse").length;
  const fb=state.allQuestions.filter(q=>q.type==="fillBlank").length;
  $("questionCount").textContent=`択一式 ${tf}問・選択式 ${fb}問`;
  $("subjectSelect").innerHTML='<option value="all">全科目</option>'+
    s.map(x=>`<option value="${x}">${x}</option>`).join("");
}
function filteredQuestions(){
  const type=$("typeSelect").value;
  const subject=$("subjectSelect").value;
  const review=$("reviewSelect").value;
  const source=$("sourceSelect").value;
  const keyword=$("keywordInput").value.trim().toLowerCase();
  const favorites=getFavorites();
  const wrong=new Set(JSON.parse(localStorage.getItem("sharoshi-wrong")||"[]"));
  let result=state.allQuestions.filter(q=>{
    const searchable=[
      q.subject,q.chapter,q.statement,q.explanation,
      ...(q.passages||[]).map(p=>p.text),
      ...(q.options||[]).map(o=>o.text),
      ...(q.blanks||[]).map(b=>b.correctText+" "+b.explanation)
    ].filter(Boolean).join(" ").toLowerCase();
    return (type==="all"||q.type===type)&&
      (subject==="all"||q.subject===subject)&&
      (source==="all"||q.sourceCategory===source)&&
      (!keyword||searchable.includes(keyword))&&
      (review==="all"||review==="weak"||
       (review==="favorite"&&favorites.has(q.id))||
       (review==="wrong"&&wrong.has(q.id)));
  });
  if(review==="weak")result.sort((a,b)=>questionWeakness(b)-questionWeakness(a));
  return result;
}
function beginSession(custom=null){
  let p=custom||filteredQuestions();
  if($("shuffleToggle").checked)p=shuffle(p);
  const c=$("countSelect").value;
  if(c!=="all")p=p.slice(0,Number(c));
  if(!p.length)return alert("対象となる問題がありません。");
  state.session=p;state.index=0;state.correct=0;state.wrongIds=[];state.responses=[];
  state.mode=$("modeSelect").value;
  stopTimer();
  if(state.mode==="mock"){
    const minutes=Number($("timeLimitSelect").value);
    state.endAt=Date.now()+minutes*60*1000;
    startTimer();
  }else{
    state.endAt=null;
    $("timerText").classList.add("hidden");
  }
  showScreen("quiz");renderQuestion();saveResume();
}
function renderQuestion(){
  const q=state.session[state.index];
  state.answered=false;
  $("subjectLabel").textContent=q.subject;
  $("chapterLabel").textContent=q.type==="fillBlank"?"選択式":(q.chapter||"");
  const sourceLabel=document.getElementById("sourceLabel");
  if(sourceLabel) sourceLabel.textContent=q.source||"";
  $("answerPanel").classList.add("hidden");
  $("nextButton").classList.add("hidden");
  $("mockReview").classList.add("hidden");

  const n=state.index+1;
  $("progressText").textContent=`${n} / ${state.session.length}`;
  $("progressBar").style.width=n/state.session.length*100+"%";
  renderFavorite();

  if(q.type==="fillBlank") renderFillBlank(q);
  else renderTrueFalse(q);
}
function renderTrueFalse(q){
  $("trueFalseArea").classList.remove("hidden");
  $("fillBlankArea").classList.add("hidden");
  $("trueFalseActions").classList.remove("selection-finished");
  $("questionText").textContent=q.statement;
  $("trueButton").classList.remove("hidden");
  $("falseButton").classList.remove("hidden");
}
function answer(v){
  if(state.answered)return;
  state.answered=true;
  const q=state.session[state.index],ok=v===q.answer;
  if(ok)state.correct++;else state.wrongIds.push(q.id);
  updateWrongStore(q.id,ok);
  state.responses.push({id:q.id,type:q.type,ok,userAnswer:v,correctAnswer:q.answer});
  $("trueButton").classList.add("hidden");
  $("falseButton").classList.add("hidden");
  if(state.mode==="practice"){
    $("resultBadge").textContent=ok?"正解":`不正解　正答：${q.answer?"○":"×"}`;
    $("resultBadge").className=`result-badge ${ok?"correct":"wrong"}`;
    $("explanationText").textContent=q.explanation||"解説はありません。";
    $("answerPanel").classList.remove("hidden");
    $("nextButton").classList.remove("hidden");
  }else{
    nextQuestion();
  }
  saveStats(ok,q);saveResume();
}
function renderFillBlank(q){
  $("trueFalseArea").classList.add("hidden");
  $("fillBlankArea").classList.remove("hidden");
  $("trueButton").classList.add("hidden");
  $("falseButton").classList.add("hidden");
  $("trueFalseActions").classList.add("selection-finished");

  state.selectionAnswers={};
  state.activeBlank=q.blanks[0].key;
  state.selectionOptions=shuffle(q.options);

  const passageHtml=q.passages.map(p=>{
    let text=p.text;
    q.blanks.forEach(b=>{
      const token=`{{${b.key}}}`;
      text=text.split(token).join(
        `<button class="inline-blank" data-key="${b.key}">${b.key}</button>`
      );
    });
    return `<p>${text}</p>`;
  }).join("");
  $("passageArea").innerHTML=passageHtml;

  $("blankNavigator").innerHTML=q.blanks.map(b=>
    `<button class="blank-chip" data-key="${b.key}">${b.key}：未選択</button>`
  ).join("");

  document.querySelectorAll("[data-key]").forEach(el=>{
    el.addEventListener("click",()=>{
      if(state.answered)return;
      state.activeBlank=el.dataset.key;
      updateSelectionUI(q);
    });
  });
  updateSelectionUI(q);
}
function updateSelectionUI(q){
  document.querySelectorAll(".inline-blank,.blank-chip").forEach(el=>{
    const key=el.dataset.key;
    el.classList.toggle("active",key===state.activeBlank);
    if(el.classList.contains("inline-blank")){
      const option=q.options.find(o=>o.id===state.selectionAnswers[key]);
      el.textContent=option?option.text:key;
      el.classList.toggle("filled",!!option);
    }else{
      const option=q.options.find(o=>o.id===state.selectionAnswers[key]);
      el.textContent=option?`${key}：${option.text}`:`${key}：未選択`;
    }
  });

  $("optionArea").innerHTML=state.selectionOptions.map(o=>{
    const selected=state.selectionAnswers[state.activeBlank]===o.id;
    return `<button class="option-button ${selected?"selected":""}" data-option-id="${o.id}">
      <span class="option-number">${o.id}</span><span>${o.text}</span>
    </button>`;
  }).join("");

  document.querySelectorAll(".option-button").forEach(btn=>{
    btn.addEventListener("click",()=>{
      if(state.answered)return;
      state.selectionAnswers[state.activeBlank]=Number(btn.dataset.optionId);
      const currentIndex=q.blanks.findIndex(b=>b.key===state.activeBlank);
      const next=q.blanks.find((b,i)=>i>currentIndex&&!state.selectionAnswers[b.key]);
      if(next)state.activeBlank=next.key;
      updateSelectionUI(q);
    });
  });
}
function gradeSelection(){
  if(state.answered)return;
  const q=state.session[state.index];
  const unanswered=q.blanks.filter(b=>!state.selectionAnswers[b.key]);
  if(unanswered.length)return alert(`未回答の空欄があります：${unanswered.map(b=>b.key).join("、")}`);

  state.answered=true;
  let correctCount=0;
  const rows=q.blanks.map(b=>{
    const selected=q.options.find(o=>o.id===state.selectionAnswers[b.key]);
    const ok=selected&&selected.id===b.correctOptionId;
    if(ok)correctCount++;
    return `<div class="selection-result-row ${ok?"ok":"ng"}">
      <strong>${b.key}　${ok?"○":"×"}</strong>
      <span>あなたの回答：${selected?.text||"未回答"}</span>
      ${ok?"":`<span>正解：${b.correctText}</span>`}
      <p>${b.explanation}</p>
    </div>`;
  }).join("");

  const allOk=correctCount===q.blanks.length;
  if(allOk)state.correct++;else state.wrongIds.push(q.id);
  updateWrongStore(q.id,allOk);

  state.responses.push({
    id:q.id,type:q.type,ok:allOk,
    correctCount,totalBlanks:q.blanks.length,
    answers:{...state.selectionAnswers}
  });
  $("gradeSelectionButton").classList.add("hidden");
  if(state.mode==="practice"){
    $("resultBadge").textContent=`${correctCount} / ${q.blanks.length} 正解`;
    $("resultBadge").className=`result-badge ${allOk?"correct":"wrong"}`;
    $("explanationText").innerHTML=rows;
    $("answerPanel").classList.remove("hidden");
    $("nextButton").classList.remove("hidden");
  }else{
    nextQuestion();
  }
  saveStats(allOk,q);saveResume();
}
function nextQuestion(){
  if(state.index+1>=state.session.length)return finishSession();
  state.index++;
  $("gradeSelectionButton").classList.remove("hidden");
  renderQuestion();saveResume();scrollTo(0,0);
}
function finishSession(){
  stopTimer();
  const t=state.session.length,p=Math.round(state.correct/t*100);
  $("scoreCircle").textContent=p+"%";
  $("scoreDetail").textContent=`${t}問中 ${state.correct}問正解`;
  $("retryWrongButton").classList.toggle("hidden",!state.wrongIds.length);
  if(state.mode==="mock")renderMockReview();
  else $("mockReview").classList.add("hidden");
  localStorage.removeItem("sharoshi-resume");
  showScreen("result");
}
function renderMockReview(){
  const qmap=new Map(state.session.map(q=>[q.id,q]));
  const html=state.responses.map((r,i)=>{
    const q=qmap.get(r.id);
    const title=q.type==="trueFalse"?(q.statement||""):(q.chapter||"選択式");
    let answer="";
    if(q.type==="trueFalse"){
      answer=`あなたの回答：${r.userAnswer?"○":"×"}／正答：${r.correctAnswer?"○":"×"}`;
    }else{
      answer=`${r.correctCount}/${r.totalBlanks}空欄正解`;
    }
    return `<article class="review-item ${r.ok?"review-ok":"review-ng"}">
      <div class="review-head"><strong>第${i+1}問 ${r.ok?"○":"×"}</strong><span>${q.subject}</span></div>
      <p>${title}</p>
      <p class="review-answer">${answer}</p>
      <p class="review-explanation">${q.explanation||((q.blanks||[]).map(b=>`${b.key}：${b.correctText}－${b.explanation}`).join("<br>"))||"解説はありません。"}</p>
    </article>`;
  }).join("");
  $("mockReview").innerHTML=`<h3>解答レビュー</h3>${html}`;
  $("mockReview").classList.remove("hidden");
}
function startTimer(){
  $("timerText").classList.remove("hidden");
  const tick=()=>{
    const remain=Math.max(0,state.endAt-Date.now());
    const totalSec=Math.ceil(remain/1000);
    const min=Math.floor(totalSec/60),sec=totalSec%60;
    $("timerText").textContent=`残り ${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
    if(remain<=0){
      stopTimer();
      alert("制限時間が終了しました。");
      finishSession();
    }
  };
  tick();
  state.timerId=setInterval(tick,1000);
}
function stopTimer(){
  if(state.timerId)clearInterval(state.timerId);
  state.timerId=null;
}
function exportLearningData(){
  const data={
    app:"SharoshiQuizWeb",version:APP_VERSION,exportedAt:new Date().toISOString(),
    stats:JSON.parse(localStorage.getItem("sharoshi-stats")||"null"),
    wrong:JSON.parse(localStorage.getItem("sharoshi-wrong")||"[]"),
    favorites:JSON.parse(localStorage.getItem("sharoshi-favorites")||"[]")
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`sharoshi-learning-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function importLearningData(event){
  const file=event.target.files?.[0];
  if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data.app!=="SharoshiQuizWeb")throw new Error("invalid");
    if(data.stats)localStorage.setItem("sharoshi-stats",JSON.stringify(data.stats));
    if(Array.isArray(data.wrong))localStorage.setItem("sharoshi-wrong",JSON.stringify(data.wrong));
    if(Array.isArray(data.favorites))localStorage.setItem("sharoshi-favorites",JSON.stringify(data.favorites));
    renderStats();
    alert("学習データを読み込みました。");
  }catch{
    alert("読み込めないファイルです。");
  }finally{
    event.target.value="";
  }
}
function updateWrongStore(id,ok){
  const wrong=new Set(JSON.parse(localStorage.getItem("sharoshi-wrong")||"[]"));
  if(ok)wrong.delete(id);else wrong.add(id);
  localStorage.setItem("sharoshi-wrong",JSON.stringify([...wrong]));
}
function saveResume(){
  localStorage.setItem("sharoshi-resume",JSON.stringify({
    ids:state.session.map(q=>q.id),index:state.index,correct:state.correct,wrongIds:state.wrongIds,
    mode:state.mode,responses:state.responses,endAt:state.endAt
  }));
  $("resumeButton").classList.remove("hidden");
}
function resumeSession(){
  const s=JSON.parse(localStorage.getItem("sharoshi-resume")||"null");
  if(!s)return;
  const m=new Map(state.allQuestions.map(q=>[q.id,q]));
  const qs=s.ids.map(id=>m.get(id)).filter(Boolean);
  if(!qs.length)return;
  state.session=qs;state.index=Math.min(s.index,qs.length-1);
  state.correct=s.correct||0;state.wrongIds=s.wrongIds||[];
  state.mode=s.mode||"practice";state.responses=s.responses||[];state.endAt=s.endAt||null;
  if(state.mode==="mock"&&state.endAt){
    if(state.endAt<=Date.now())return finishSession();
    startTimer();
  }
  showScreen("quiz");renderQuestion();
}
async function init(){
  // file:// で直接開いても動作するよう、同梱のJSデータを優先して使用します。
  if(Array.isArray(window.SHAROSHI_QUESTIONS)){
    state.allQuestions=window.SHAROSHI_QUESTIONS;
  }else{
    // 開発用サーバーで起動した場合の予備読み込み。
    const response=await fetch("questions.json?v=40",{cache:"no-store"});
    if(!response.ok)throw new Error("question data load failed");
    state.allQuestions=await response.json();
  }

  const total=state.allQuestions.length;
  const trueFalseCount=state.allQuestions.filter(q=>q.type!=="fillBlank").length;
  const fillBlankCount=state.allQuestions.filter(q=>q.type==="fillBlank").length;
  document.querySelectorAll('[data-question-count], #questionCount').forEach(el=>{
    el.textContent=`収録 ${total}問（択一式 ${trueFalseCount}問・選択式 ${fillBlankCount}問）`;
  });
  buildSubjects();
  renderStats();
  if(localStorage.getItem("sharoshi-resume"))$("resumeButton").classList.remove("hidden");
}

$("startButton").onclick=()=>beginSession();
$("selectionDemoButton").onclick=()=>{
  const demo=state.allQuestions.filter(q=>q.type==="fillBlank");
  beginSession(demo);
};
$("resumeButton").onclick=resumeSession;
$("trueButton").onclick=()=>answer(true);
$("falseButton").onclick=()=>answer(false);
$("gradeSelectionButton").onclick=gradeSelection;
$("nextButton").onclick=nextQuestion;
$("favoriteButton").onclick=toggleFavorite;
$("closeQuiz").onclick=()=>{saveResume();showScreen("home")};
$("backHomeButton").onclick=()=>showScreen("home");
$("modeSelect").onchange=()=>{
  $("mockSettings").classList.toggle("hidden",$("modeSelect").value!=="mock");
};
$("exportButton").onclick=exportLearningData;
$("importInput").onchange=importLearningData;
$("retryWrongButton").onclick=()=>beginSession(state.allQuestions.filter(q=>state.wrongIds.includes(q.id)));
$("resetHistoryButton").onclick=()=>{
  if(!confirm("学習履歴・間違い履歴をすべて削除しますか？"))return;
  localStorage.removeItem("sharoshi-stats");
  localStorage.removeItem("sharoshi-wrong");
  renderStats();
};

if("serviceWorker"in navigator&&location.protocol.startsWith("http")){
  navigator.serviceWorker.register("sw.js?v=40",{updateViaCache:"none"}).then(r=>r.update()).catch(()=>{});
}
init().catch(()=>alert("問題データの読み込みに失敗しました。READMEを確認してください。"));
