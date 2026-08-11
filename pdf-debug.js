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
  const copyColor=c=>({...c});
  function glyphWidth(value){
    if(!Array.isArray(value))return null;
    const widths=value.filter(g=>g&&typeof g==="object"&&Number.isFinite(g.width)).map(g=>g.width);
    return widths.length?widths.reduce((sum,width)=>sum+width,0)/widths.length:null;
  }
  function operatorPaintRuns(list){
    const O=window.pdfjsLib.OPS,runs=[];
    let fill=rgb(0,0,0),stroke=rgb(0,0,0),fontName="",fontSize=0,renderingMode=0,lineWidth=1,charSpacing=0,wordSpacing=0,horizontalScale=100,textRise=0;
    const stack=[];
    for(let i=0;i<list.fnArray.length;i++){
      const op=list.fnArray[i],a=list.argsArray[i]||[];
      if(op===O.save)stack.push({fill:copyColor(fill),stroke:copyColor(stroke),fontName,fontSize,renderingMode,lineWidth,charSpacing,wordSpacing,horizontalScale,textRise});
      else if(op===O.restore&&stack.length)({fill,stroke,fontName,fontSize,renderingMode,lineWidth,charSpacing,wordSpacing,horizontalScale,textRise}=stack.pop());
      else if(op===O.setFillRGBColor)fill=rgb(a[0],a[1],a[2]);
      else if(op===O.setFillGray)fill=rgb(a[0],a[0],a[0]);
      else if(op===O.setFillCMYKColor)fill=cmyk(a[0],a[1],a[2],a[3]);
      else if(op===O.setStrokeRGBColor)stroke=rgb(a[0],a[1],a[2]);
      else if(op===O.setStrokeGray)stroke=rgb(a[0],a[0],a[0]);
      else if(op===O.setStrokeCMYKColor)stroke=cmyk(a[0],a[1],a[2],a[3]);
      else if(op===O.setTextRenderingMode)renderingMode=Number(a[0])||0;
      else if(op===O.setLineWidth)lineWidth=Math.abs(Number(a[0]))||0;
      else if(op===O.setCharSpacing)charSpacing=Number(a[0])||0;
      else if(op===O.setWordSpacing)wordSpacing=Number(a[0])||0;
      else if(op===O.setHScale)horizontalScale=Number(a[0])||0;
      else if(op===O.setTextRise)textRise=Number(a[0])||0;
      else if(op===O.setFont){fontName=String(a[0]||"");fontSize=Math.abs(Number(a[1]))||0;}
      else if(op===O.showText||op===O.showSpacedText){
        const text=glyphText(a[0]);
        if(text)runs.push({text,color:copyColor(fill),strokeColor:copyColor(stroke),fontName,fontSize,operatorIndex:i,renderingMode,lineWidth,glyphWidth:glyphWidth(a[0]),charSpacing,wordSpacing,horizontalScale,textRise});
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
      const result=run?{...run,color:copyColor(run.color),strokeColor:copyColor(run.strokeColor)}:{color:rgb(0,0,0),strokeColor:rgb(0,0,0),fontName:"",fontSize:0,operatorIndex:-1,text:"",renderingMode:0,lineWidth:0,glyphWidth:null,charSpacing:0,wordSpacing:0,horizontalScale:100,textRise:0};
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
  function resolvedFont(page,name){
    if(!name||!page.commonObjs?.has(name))return {};
    try{return page.commonObjs.get(name)||{};}catch(error){return {};}
  }
  function fontDetails(page,item,style,paint){
    const font=resolvedFont(page,paint.fontName);
    const properties=font.properties||font;
    const loadedName=font.loadedName||properties.loadedName||paint.fontName||"";
    const originalName=font.name||font.originalName||properties.name||properties.originalName||"";
    const fallbackName=font.fallbackName||properties.fallbackName||"";
    const fontWeight=font.fontWeight||properties.fontWeight||style.fontWeight||"";
    const bold=Boolean(font.bold||properties.bold)||Number.parseInt(fontWeight,10)>=600||/(?:bold|semibold|demibold|heavy|black|太ゴ|中ゴ|角ゴ)/i.test([item.fontName,style.fontFamily,paint.fontName,loadedName,originalName,fallbackName,fontWeight].join(" "));
    const black=Boolean(font.black||properties.black)||/(?:^|[-_ ])black(?:$|[-_ ])/i.test([loadedName,originalName,fallbackName,fontWeight].join(" "));
    const isType3Font=Boolean(font.isType3Font??properties.isType3Font)||(font.type||properties.type)==="Type3";
    const fontType=font.fontType||font.type||properties.fontType||properties.type||"";
    const fontSubtype=font.subtype||properties.subtype||"";
    return {loadedName,originalName,fallbackName,fontWeight,bold,black,isType3Font,fontType,fontSubtype};
  }
  async function analyzePage(page,pageNumber){
    const [text,ops]=await Promise.all([page.getTextContent(),page.getOperatorList()]);
    const mapped=mapColors(text.items,operatorPaintRuns(ops));
    const sizes=text.items.filter(i=>i.str.trim()).map(i=>Math.hypot(i.transform[2],i.transform[3])||Math.abs(i.height));
    const bodySize=median(sizes.filter(Boolean));
    const entries=text.items.map((item,index)=>{
      const style=text.styles[item.fontName]||{},paint=mapped[index];
      const size=Math.hypot(item.transform[2],item.transform[3])||Math.abs(item.height)||paint.fontSize;
      const details=fontDetails(page,item,style,paint);
      const colorType=classifyColor(paint.color);
      const bodySized=bodySize===0||(size>=bodySize*.72&&size<=bodySize*1.35);
      const normalizedAdvance=size?item.width/size:null;
      return {text:item.str,pageNumber,x:item.transform[4],y:item.transform[5],width:item.width,height:item.height,fontName:item.fontName,fontFamily:style.fontFamily||"",operatorFontName:paint.fontName,fontSize:size,fillColor:paint.color,strokeColor:paint.strokeColor,colorType,category:colorType==="red"?"red":colorType==="blue"?"blue":null,bodySized,bodySize,operatorIndex:paint.operatorIndex,renderingMode:paint.renderingMode,lineWidth:paint.lineWidth,glyphWidth:paint.glyphWidth,normalizedAdvance,charSpacing:paint.charSpacing,wordSpacing:paint.wordSpacing,horizontalScale:paint.horizontalScale,textRise:paint.textRise,samePositionCount:1,...details,transform:item.transform};
    });
    const positions=new Map();
    for(const entry of entries){
      if(!entry.text.trim())continue;
      const key=[entry.text,entry.x.toFixed(2),entry.y.toFixed(2),entry.fontSize.toFixed(2)].join("|");
      positions.set(key,(positions.get(key)||0)+1);
    }
    for(const entry of entries){
      const key=[entry.text,entry.x.toFixed(2),entry.y.toFixed(2),entry.fontSize.toFixed(2)].join("|");
      entry.samePositionCount=positions.get(key)||1;
    }
    return {entries,bodySize};
  }
  function viewportBox(entry,viewport){
    const m=window.pdfjsLib.Util.transform(viewport.transform,entry.transform);
    const height=Math.max(8,Math.hypot(m[2],m[3]));
    const advance=Math.max(8,Math.abs(entry.width*viewport.scale));
    const angle=Math.atan2(m[1],m[0]);
    const dx=Math.cos(angle)*advance,dy=Math.sin(angle)*advance;
    const hx=-Math.sin(angle)*height,hy=Math.cos(angle)*height;
    const points=[[m[4],m[5]],[m[4]+dx,m[5]+dy],[m[4]-hx,m[5]-hy],[m[4]+dx-hx,m[5]+dy-hy]];
    const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
    const left=Math.min(...xs),top=Math.min(...ys),right=Math.max(...xs),bottom=Math.max(...ys);
    return {left,top,width:Math.max(8,right-left),height:Math.max(8,bottom-top)};
  }
  function report(entries){
    const candidates=entries.filter(e=>e.category);
    const counts=t=>candidates.filter(e=>e.category===t).length;
    const lines=[`解析対象: ${entries.length} テキスト項目`,`赤: ${counts("red")} / 青: ${counts("blue")}`,""];
    for(const e of candidates){
      lines.push(`${{red:"赤文字",blue:"青文字"}[e.category]}候補: ${JSON.stringify(e.text)}`,
        `page=${e.pageNumber} x=${e.x.toFixed(2)} y=${e.y.toFixed(2)} width=${e.width.toFixed(2)} height=${e.height.toFixed(2)}`,
        `font=${e.fontName}${e.fontFamily?` (${e.fontFamily})`:""} operatorFont=${e.operatorFontName} size=${e.fontSize.toFixed(2)} bold=${e.bold}`,
        `color=${colorText(e.fillColor)} stroke=${colorText(e.strokeColor)} operatorIndex=${e.operatorIndex} mode=${e.renderingMode}`,"");
    }
    $("pdfReport").textContent=lines.join("\n");
    $("pdfReportPanel").classList.remove("hidden");
    console.group("PDF重要語句 技術検証");console.log(lines.join("\n"));console.groupEnd();
  }
  function logBlackDiagnostic(entry){
    const diagnostic={text:entry.text,fontName:entry.fontName,fontFamily:entry.fontFamily,operatorFontName:entry.operatorFontName,loadedName:entry.loadedName,originalName:entry.originalName,fallbackName:entry.fallbackName,fontWeight:entry.fontWeight,bold:entry.bold,black:entry.black,fontSize:entry.fontSize,transform:entry.transform,width:entry.width,height:entry.height,glyphWidth:entry.glyphWidth,normalizedAdvance:entry.normalizedAdvance,charSpacing:entry.charSpacing,wordSpacing:entry.wordSpacing,horizontalScale:entry.horizontalScale,textRise:entry.textRise,renderingMode:entry.renderingMode,fillColor:colorText(entry.fillColor),strokeColor:colorText(entry.strokeColor),lineWidth:entry.lineWidth,samePositionCount:entry.samePositionCount,operatorIndex:entry.operatorIndex,isType3Font:entry.isType3Font,fontType:entry.fontType,fontSubtype:entry.fontSubtype};
    console.group(`黒文字クリック診断: ${JSON.stringify(entry.text)}`);console.table(diagnostic);console.log(diagnostic);console.groupEnd();
  }
  function registerBlackClick(hit,entry){
    let lastPointerUp=0;
    hit.addEventListener("pointerup",event=>{
      if(event.pointerType==="mouse"&&event.button!==0)return;
      lastPointerUp=Date.now();
      console.log("BLACK TEXT CLICKED");
      logBlackDiagnostic(entry);
    });
    hit.addEventListener("click",()=>{
      if(Date.now()-lastPointerUp<500)return;
      console.log("BLACK TEXT CLICKED");
      logBlackDiagnostic(entry);
    });
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
      const canvas=document.createElement("canvas"),overlay=document.createElement("div"),hitLayer=document.createElement("div");overlay.className="pdf-debug-overlay";hitLayer.className="pdf-diagnostic-layer";
      const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.floor(viewport.width*ratio);canvas.height=Math.floor(viewport.height*ratio);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;
      wrap.append(canvas,overlay,hitLayer);viewer.append(wrap);
      await page.render({canvasContext:canvas.getContext("2d"),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]}).promise;
      const analysis=await analyzePage(page,n);all=all.concat(analysis.entries);
      for(const e of analysis.entries.filter(x=>x.category)){
        const box=viewportBox(e,viewport),mark=document.createElement("span");mark.className=`pdf-debug-box ${e.category}`;mark.title=`${e.text} | ${colorText(e.fillColor)} | ${e.fontName}`;
        Object.assign(mark.style,{left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`});overlay.append(mark);
      }
      for(const e of analysis.entries.filter(x=>x.colorType==="black"&&x.text.trim())){
        const box=viewportBox(e,viewport),hit=document.createElement("button");hit.type="button";hit.className="pdf-black-hit";hit.title=`黒文字を診断: ${e.text}`;hit.setAttribute("aria-label",`黒文字を診断: ${e.text}`);
        Object.assign(hit.style,{left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`});registerBlackClick(hit,e);hitLayer.append(hit);
      }
      state.pages.push({page,analysis,viewport});
    }
    report(all);$("pdfStatus").textContent=`${state.pdf.numPages}ページを解析しました。黒文字をクリックすると診断情報をConsoleに表示します。`;
    toggleOverlay();
  }
  function toggleOverlay(){
    const enabled=$("pdfDebugToggle").checked;
    document.querySelectorAll(".pdf-debug-overlay").forEach(layer=>{layer.hidden=!enabled;});
    document.querySelectorAll(".pdf-diagnostic-layer").forEach(layer=>{layer.classList.toggle("diagnostic-visible",enabled);});
  }
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
