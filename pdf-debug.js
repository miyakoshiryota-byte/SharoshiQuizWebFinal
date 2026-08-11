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
  const isStrokeMode=mode=>[1,2,5,6].includes(mode);
  function glyphWidth(value){
    if(!Array.isArray(value))return null;
    const widths=value.filter(g=>g&&typeof g==="object"&&Number.isFinite(g.width)).map(g=>g.width);
    return widths.length?widths.reduce((sum,width)=>sum+width,0)/widths.length:null;
  }
  function glyphMetrics(value){
    const glyphs=Array.isArray(value)?value.filter(g=>g&&typeof g==="object"&&typeof g.unicode==="string"):[];
    const widths=glyphs.filter(g=>Number.isFinite(g.width)).map(g=>g.width);
    return {glyphCount:glyphs.length,glyphWidth:glyphWidth(value),normalizedAdvance:widths.length?widths.reduce((sum,width)=>sum+width,0)/1000:null,glyphs:glyphs.map(g=>({unicode:g.unicode,width:g.width,isSpace:Boolean(g.isSpace),fontChar:g.fontChar}))};
  }
  function operatorNameMap(O){
    return new Map(Object.entries(O).filter(([,value])=>typeof value==="number").map(([name,value])=>[value,name]));
  }
  function compactArg(value){
    if(Array.isArray(value))return value.length>12?[...value.slice(0,12).map(compactArg),`… ${value.length-12} more`]:value.map(compactArg);
    if(value&&typeof value==="object")return value.unicode!==undefined?{unicode:value.unicode,width:value.width,isSpace:value.isSpace}:String(value);
    return value;
  }
  function operatorPaintRuns(list){
    const O=window.pdfjsLib.OPS,runs=[],names=operatorNameMap(O);
    let fill=rgb(0,0,0),stroke=rgb(0,0,0),fontName="",fontSize=0,renderingMode=0,lineWidth=1,charSpacing=0,wordSpacing=0,horizontalScale=100,textRise=0;
    const stack=[];
    const contextAt=index=>{
      const from=Math.max(0,index-8),to=Math.min(list.fnArray.length-1,index+8),context=[];
      for(let j=from;j<=to;j++)context.push({operatorIndex:j,relative:j-index,name:names.get(list.fnArray[j])||`OPS(${list.fnArray[j]})`,args:(list.argsArray[j]||[]).map(compactArg)});
      return context;
    };
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
        if(text)runs.push({text,color:copyColor(fill),strokeColor:copyColor(stroke),fontName,fontSize,operatorIndex:i,renderingMode,lineWidth,charSpacing,wordSpacing,horizontalScale,textRise,...glyphMetrics(a[0]),operatorContext:contextAt(i)});
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
      const result=run?{...run,color:copyColor(run.color),strokeColor:copyColor(run.strokeColor)}:{color:rgb(0,0,0),strokeColor:rgb(0,0,0),fontName:"",fontSize:0,operatorIndex:-1,text:"",renderingMode:0,lineWidth:0,charSpacing:0,wordSpacing:0,horizontalScale:100,textRise:0,glyphCount:0,glyphWidth:null,normalizedAdvance:null,glyphs:[],operatorContext:[]};
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
    const fontType=font.fontType||properties.fontType||font.type||properties.type||"";
    const subtype=font.subtype||properties.subtype||"";
    const fontData=font.data||properties.data||font.file?.data||properties.file?.data;
    const embeddedFontBytes=fontData?.byteLength??fontData?.length??0;
    const fontObjectSummary={constructor:font.constructor?.name||"",keys:Object.keys(font).sort(),loadedName,originalName,fallbackName,fontWeight,bold,black,isType3Font,fontType,subtype,embeddedFontBytes};
    return {loadedName,originalName,fallbackName,fontWeight,bold,black,isType3Font,fontType,subtype,embeddedFontBytes,fontObjectSummary,pdfjsFontObject:font};
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
      const strokeBold=isStrokeMode(paint.renderingMode)&&classifyColor(paint.strokeColor)==="black"&&paint.lineWidth>0;
      return {text:item.str,pageNumber,x:item.transform[4],y:item.transform[5],width:item.width,height:item.height,fontName:item.fontName,fontFamily:style.fontFamily||"",operatorFontName:paint.fontName,fontSize:size,color:paint.color,strokeColor:paint.strokeColor,colorType,category:null,bodySized,bodySize,operatorIndex:paint.operatorIndex,renderingMode:paint.renderingMode,lineWidth:paint.lineWidth,hasStroke:isStrokeMode(paint.renderingMode),charSpacing:paint.charSpacing,wordSpacing:paint.wordSpacing,horizontalScale:paint.horizontalScale,textRise:paint.textRise,glyphCount:paint.glyphCount,glyphWidth:paint.glyphWidth,normalizedAdvance:paint.normalizedAdvance,glyphs:paint.glyphs,operatorContext:paint.operatorContext,samePositionDrawCount:1,sameTextDrawCount:1,boldEvidence:details.bold||details.black?["font metadata"]:strokeBold?["stroke rendering"]:[],strokeBold,...details,transform:[...item.transform]};
    });
    const positions=new Map();
    const repeatedText=new Map();
    for(const entry of entries){
      if(!entry.text.trim())continue;
      const key=[entry.text,entry.x.toFixed(2),entry.y.toFixed(2),entry.fontSize.toFixed(2)].join("|");
      positions.set(key,(positions.get(key)||0)+1);
      repeatedText.set(entry.text,(repeatedText.get(entry.text)||0)+1);
    }
    for(let index=0;index<entries.length;index++){
      const entry=entries[index];
      const key=[entry.text,entry.x.toFixed(2),entry.y.toFixed(2),entry.fontSize.toFixed(2)].join("|");
      entry.samePositionDrawCount=positions.get(key)||1;
      entry.sameTextDrawCount=repeatedText.get(entry.text)||1;
      entry.previousTextRun=index?{text:entries[index-1].text,fontName:entries[index-1].fontName,operatorFontName:entries[index-1].operatorFontName,fontSize:entries[index-1].fontSize,operatorIndex:entries[index-1].operatorIndex}:null;
      entry.nextTextRun=index+1<entries.length?{text:entries[index+1].text,fontName:entries[index+1].fontName,operatorFontName:entries[index+1].operatorFontName,fontSize:entries[index+1].fontSize,operatorIndex:entries[index+1].operatorIndex}:null;
      const previous=entries[index-1],next=entries[index+1],sameLine=other=>Boolean(other)&&Math.abs(other.y-entry.y)<=Math.max(1,entry.fontSize*.35);
      entry.sameLineFontSwitchFromPrevious=sameLine(previous)&&previous.operatorFontName!==entry.operatorFontName;
      entry.sameLineFontSwitchToNext=sameLine(next)&&next.operatorFontName!==entry.operatorFontName;
      if(entry.samePositionDrawCount>1)entry.boldEvidence.push("same-position draw");
      const hasBoldEvidence=entry.boldEvidence.length>0;
      const blackPaint=entry.colorType==="black"||entry.strokeBold;
      entry.category=entry.colorType==="red"?"red":entry.colorType==="blue"?"blue":(blackPaint&&entry.bodySized&&hasBoldEvidence?"blackBold":null);
    }
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
        `font=${e.fontName}${e.fontFamily?` (${e.fontFamily})`:""} operatorFont=${e.operatorFontName} size=${e.fontSize.toFixed(2)} bold=${e.bold}`,
        `color=${colorText(e.color)} stroke=${colorText(e.strokeColor)} operatorIndex=${e.operatorIndex} mode=${e.renderingMode}`,
        `boldEvidence=${e.boldEvidence.join(", ")||"none"} samePosition=${e.samePositionDrawCount} glyphWidth=${e.glyphWidth??"unknown"}`,"");
    }
    $("pdfReport").textContent=lines.join("\n");
    $("pdfReportPanel").classList.remove("hidden");
    const blackBold=entries.filter(e=>e.category==="blackBold");
    const normalBlack=entries.filter(e=>e.colorType==="black"&&!e.category&&e.bodySized).slice(0,30);
    const blackFonts=[...new Map(entries.filter(e=>e.colorType==="black").map(e=>[[e.fontName,e.operatorFontName,e.loadedName,e.originalName].join("|"),{fontName:e.fontName,fontFamily:e.fontFamily,operatorFontName:e.operatorFontName,loadedName:e.loadedName,originalName:e.originalName,fallbackName:e.fallbackName,fontWeight:e.fontWeight,bold:e.bold,black:e.black,isType3Font:e.isType3Font,fontType:e.fontType,subtype:e.subtype,embeddedFontBytes:e.embeddedFontBytes}])).values()];
    console.group("PDF重要語句 技術検証");console.log(lines.join("\n"));console.group("黒太字候補");console.table(blackBold);console.groupEnd();console.group("通常黒文字（比較サンプル・最大30件）");console.table(normalBlack);console.groupEnd();console.group("黒文字フォント一覧");console.table(blackFonts);console.groupEnd();console.groupEnd();
  }
  function inspectBlack(entry){
    const diagnostic={text:entry.text,page:entry.pageNumber,fontName:entry.fontName,fontFamily:entry.fontFamily,operatorFont:entry.operatorFontName,loadedName:entry.loadedName,originalName:entry.originalName,fallbackName:entry.fallbackName,fontWeight:entry.fontWeight,bold:entry.bold,black:entry.black,fontSize:entry.fontSize,transform:entry.transform,width:entry.width,height:entry.height,glyphCount:entry.glyphCount,glyphWidth:entry.glyphWidth,normalizedAdvance:entry.normalizedAdvance,charSpacing:entry.charSpacing,wordSpacing:entry.wordSpacing,horizontalScale:entry.horizontalScale,textRise:entry.textRise,renderingMode:entry.renderingMode,fill:colorText(entry.color),stroke:colorText(entry.strokeColor),lineWidth:entry.lineWidth,hasStroke:entry.hasStroke,operatorIndex:entry.operatorIndex,samePositionCount:entry.samePositionDrawCount,sameTextDrawCount:entry.sameTextDrawCount,isType3Font:entry.isType3Font,fontType:entry.fontType,subtype:entry.subtype,embeddedFontBytes:entry.embeddedFontBytes,sameLineFontSwitchFromPrevious:entry.sameLineFontSwitchFromPrevious,sameLineFontSwitchToNext:entry.sameLineFontSwitchToNext,previousTextRun:entry.previousTextRun,nextTextRun:entry.nextTextRun,glyphs:entry.glyphs,fontObjectSummary:entry.fontObjectSummary};
    console.group(`黒文字クリック診断: ${JSON.stringify(entry.text)}`);console.log("診断値",diagnostic);console.log("PDF.js内部font object",entry.pdfjsFontObject);console.table(entry.operatorContext);console.groupEnd();
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
      for(const e of analysis.entries.filter(x=>x.colorType==="black"&&x.text.trim())){
        const box=viewportBox(e,viewport),hit=document.createElement("button");hit.type="button";hit.className="pdf-black-inspect-hit";hit.disabled=true;hit.title=`黒文字を診断: ${e.text}`;hit.setAttribute("aria-label",`黒文字を診断: ${e.text}`);
        Object.assign(hit.style,{left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`});hit.addEventListener("click",()=>inspectBlack(e));overlay.append(hit);
      }
      state.pages.push({page,analysis,viewport});
    }
    report(all);$("pdfStatus").textContent=`${state.pdf.numPages}ページを解析しました。色値・フォント・座標は解析結果とconsoleで確認できます。`;
    toggleOverlay();toggleBlackInspect();
  }
  function toggleOverlay(){document.querySelectorAll(".pdf-debug-box").forEach(x=>x.hidden=!$("pdfDebugToggle").checked);}
  function toggleBlackInspect(){const enabled=$("pdfBlackInspectToggle").checked;document.querySelectorAll(".pdf-debug-overlay").forEach(x=>x.classList.toggle("black-inspect",enabled));document.querySelectorAll(".pdf-black-inspect-hit").forEach(x=>x.disabled=!enabled);}
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
    $("pdfInput").addEventListener("change",load);$("pdfDebugToggle").addEventListener("change",toggleOverlay);$("pdfBlackInspectToggle").addEventListener("change",toggleBlackInspect);
    let timer;window.addEventListener("resize",()=>{if(!state.pdf)return;clearTimeout(timer);timer=setTimeout(render,250);});
  }
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",init):init();
})();
