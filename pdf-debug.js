/* PDF.js based technical probe: keeps the source PDF on canvas and only overlays debug boxes. */
(()=>{
  "use strict";
  const PDFJS_VERSION="3.11.174";
  const worker=`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
  const state={pdf:null,buffer:null,pages:[],renderToken:0};
  const $=id=>document.getElementById(id);
  const clamp=v=>Math.max(0,Math.min(255,Math.round(v<=1?v*255:v)));
  const rgb=(r,g,b)=>({r:clamp(r),g:clamp(g),b:clamp(b)});
  const colorText=c=>`rgb(${c.r}, ${c.g}, ${c.b}) / #${[c.r,c.g,c.b].map(v=>v.toString(16).padStart(2,"0")).join("")}`;
  const classifyColor=c=>{
    const {r,g,b}=c;
    if(r>=120&&r>=g*1.35&&r>=b*1.25)return "red";
    if(b>=80&&b>=r*1.25&&b>=g*1.08)return "blue";
    if(Math.max(r,g,b)<=70)return "black";
    return "other";
  };
  const cmyk=(c,m,y,k)=>{
    [c,m,y,k]=[c,m,y,k].map(v=>v>1?v/255:v);
    return rgb(1-Math.min(1,c*(1-k)+k),1-Math.min(1,m*(1-k)+k),1-Math.min(1,y*(1-k)+k));
  };
  function glyphText(value){
    if(typeof value==="string")return value;
    if(!Array.isArray(value))return "";
    return value.map(g=>typeof g==="string"?g:(g&&typeof g.unicode==="string"?g.unicode:"")).join("");
  }
  function operatorPaintRuns(list){
    const O=window.pdfjsLib.OPS,runs=[];
    let fill=rgb(0,0,0),fontName="",fontSize=0;
    const stack=[];
    for(let i=0;i<list.fnArray.length;i++){
      const op=list.fnArray[i],a=list.argsArray[i]||[];
      if(op===O.save)stack.push({fill:{...fill},fontName,fontSize});
      else if(op===O.restore&&stack.length)({fill,fontName,fontSize}=stack.pop());
      else if(op===O.setFillRGBColor)fill=rgb(a[0],a[1],a[2]);
      else if(op===O.setFillGray)fill=rgb(a[0],a[0],a[0]);
      else if(op===O.setFillCMYKColor)fill=cmyk(a[0],a[1],a[2],a[3]);
      else if(op===O.setFont){fontName=String(a[0]||"");fontSize=Math.abs(Number(a[1]))||0;}
      else if(op===O.showText||op===O.showSpacedText){
        const text=glyphText(a[0]);
        if(text)runs.push({text,color:{...fill},fontName,fontSize,operatorIndex:i});
      }
    }
    return runs;
  }
  function mapColors(items,runs){
    let runIndex=0,offset=0;
    return items.map(item=>{
      const wanted=item.str.replace(/\s/g,"");
      while(runIndex<runs.length&&offset>=runs[runIndex].text.replace(/\s/g,"").length){runIndex++;offset=0;}
      const run=runs[runIndex];
      const result=run?{...run,color:{...run.color}}:{color:rgb(0,0,0),fontName:"",fontSize:0,operatorIndex:-1,text:""};
      let remaining=wanted.length;
      while(remaining>0&&runIndex<runs.length){
        const available=Math.max(0,runs[runIndex].text.replace(/\s/g,"").length-offset);
        const used=Math.min(remaining,available);remaining-=used;offset+=used;
        if(!available||offset>=runs[runIndex].text.replace(/\s/g,"").length){runIndex++;offset=0;}
      }
      return result;
    });
  }
  const median=values=>{const a=[...values].sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:0;};
  async function analyzePage(page,pageNumber){
    const [text,ops]=await Promise.all([page.getTextContent(),page.getOperatorList()]);
    const mapped=mapColors(text.items,operatorPaintRuns(ops));
    const sizes=text.items.filter(i=>i.str.trim()).map(i=>Math.hypot(i.transform[2],i.transform[3])||Math.abs(i.height));
    const bodySize=median(sizes.filter(Boolean));
    const entries=text.items.map((item,index)=>{
      const style=text.styles[item.fontName]||{},paint=mapped[index];
      const font=[item.fontName,style.fontFamily,paint.fontName].filter(Boolean).join(" / ");
      const size=Math.hypot(item.transform[2],item.transform[3])||Math.abs(item.height)||paint.fontSize;
      const bold=/(bold|semibold|demibold|heavy|black|太ゴ|中ゴ|角ゴ)/i.test(font);
      const colorType=classifyColor(paint.color);
      const bodySized=bodySize===0||(size>=bodySize*.72&&size<=bodySize*1.35);
      const category=colorType==="red"?"red":colorType==="blue"?"blue":(colorType==="black"&&bold&&bodySized?"blackBold":null);
      return {text:item.str,pageNumber,x:item.transform[4],y:item.transform[5],width:item.width,height:item.height,fontName:item.fontName,fontFamily:style.fontFamily||"",fontSize:size,bold,color:paint.color,colorType,category,bodySized,bodySize,operatorIndex:paint.operatorIndex,transform:item.transform};
    });
    return {entries,bodySize};
  }
  function viewportBox(entry,viewport){
    const m=window.pdfjsLib.Util.transform(viewport.transform,entry.transform);
    const height=Math.max(1,Math.hypot(m[2],m[3]));
    const width=Math.max(1,entry.width*viewport.scale);
    return {left:m[4],top:m[5]-height,width,height};
  }
  function report(entries){
    const candidates=entries.filter(e=>e.category);
    const counts=t=>candidates.filter(e=>e.category===t).length;
    const lines=[`解析対象: ${entries.length} テキスト項目`,`赤: ${counts("red")} / 青: ${counts("blue")} / 黒太字（本文相当）: ${counts("blackBold")}`,""];
    for(const e of candidates){
      lines.push(`${{red:"赤文字",blue:"青文字",blackBold:"黒太字"}[e.category]}候補: ${JSON.stringify(e.text)}`,
        `page=${e.pageNumber} x=${e.x.toFixed(2)} y=${e.y.toFixed(2)} width=${e.width.toFixed(2)} height=${e.height.toFixed(2)}`,
        `font=${e.fontName}${e.fontFamily?` (${e.fontFamily})`:""} size=${e.fontSize.toFixed(2)} bold=${e.bold}`,
        `color=${colorText(e.color)} operatorIndex=${e.operatorIndex}`,"");
    }
    $("pdfReport").textContent=lines.join("\n");
    $("pdfReportPanel").classList.remove("hidden");
    console.group("PDF重要語句 技術検証");console.table(candidates);console.log(lines.join("\n"));console.groupEnd();
  }
  async function render(){
    if(!state.pdf)return;
    const token=++state.renderToken,viewer=$("pdfViewer");viewer.replaceChildren();state.pages=[];
    const available=Math.max(280,Math.min(1100,viewer.clientWidth||document.documentElement.clientWidth-40));
    let all=[];
    for(let n=1;n<=state.pdf.numPages;n++){
      if(token!==state.renderToken)return;
      const page=await state.pdf.getPage(n),base=page.getViewport({scale:1}),scale=available/base.width,viewport=page.getViewport({scale});
      const wrap=document.createElement("section");wrap.className="pdf-page";wrap.style.width=`${viewport.width}px`;wrap.style.height=`${viewport.height}px`;
      const canvas=document.createElement("canvas"),overlay=document.createElement("div");overlay.className="pdf-debug-overlay";
      const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.floor(viewport.width*ratio);canvas.height=Math.floor(viewport.height*ratio);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;
      wrap.append(canvas,overlay);viewer.append(wrap);
      await page.render({canvasContext:canvas.getContext("2d"),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]}).promise;
      const analysis=await analyzePage(page,n);all=all.concat(analysis.entries);
      for(const e of analysis.entries.filter(x=>x.category)){
        const box=viewportBox(e,viewport),mark=document.createElement("span");mark.className=`pdf-debug-box ${e.category}`;mark.title=`${e.text} | ${colorText(e.color)} | ${e.fontName}`;
        Object.assign(mark.style,{left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`});overlay.append(mark);
      }
      state.pages.push({page,analysis,viewport});
    }
    report(all);$("pdfStatus").textContent=`${state.pdf.numPages}ページを解析しました。色値・フォント・座標は解析結果とconsoleで確認できます。`;
    toggleOverlay();
  }
  function toggleOverlay(){document.querySelectorAll(".pdf-debug-overlay").forEach(x=>x.hidden=!$("pdfDebugToggle").checked);}
  async function load(event){
    const file=event.target.files?.[0];if(!file)return;
    $("pdfStatus").textContent="PDFを読み込み、描画命令とテキストを解析しています…";
    try{
      state.buffer=await file.arrayBuffer();
      state.pdf=await window.pdfjsLib.getDocument({data:state.buffer}).promise;
      await render();
    }catch(error){console.error(error);$("pdfStatus").textContent=`解析できませんでした: ${error.message}`;}
  }
  function init(){
    if(!window.pdfjsLib){$("pdfStatus").textContent="PDF.jsを読み込めませんでした。通信状態を確認してください。";return;}
    window.pdfjsLib.GlobalWorkerOptions.workerSrc=worker;
    $("pdfInput").addEventListener("change",load);$("pdfDebugToggle").addEventListener("change",toggleOverlay);
    let timer;window.addEventListener("resize",()=>{if(!state.pdf)return;clearTimeout(timer);timer=setTimeout(render,250);});
  }
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",init):init();
})();
