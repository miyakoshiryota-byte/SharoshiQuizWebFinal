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
  function glyphMetrics(value){
    if(!Array.isArray(value))return {glyphCount:0,glyphWidth:0};
    const glyphs=value.filter(g=>g&&typeof g==="object"&&typeof g.width==="number");
    return {
      glyphCount:glyphs.length,
      glyphWidth:glyphs.length?glyphs.reduce((sum,g)=>sum+Math.abs(g.width),0)/glyphs.length:0
    };
  }
  const renderingModeName=mode=>["fill","stroke","fill+stroke","invisible","fill+clip","stroke+clip","fill+stroke+clip","clip"][mode]||`unknown(${mode})`;
  function operatorPaintRuns(list){
    const O=window.pdfjsLib.OPS,runs=[];
    let fill=rgb(0,0,0),stroke=rgb(0,0,0),fontName="",fontSize=0,renderingMode=0,lineWidth=1;
    const stack=[];
    for(let i=0;i<list.fnArray.length;i++){
      const op=list.fnArray[i],a=list.argsArray[i]||[];
      if(op===O.save)stack.push({fill:{...fill},stroke:{...stroke},fontName,fontSize,renderingMode,lineWidth});
      else if(op===O.restore&&stack.length)({fill,stroke,fontName,fontSize,renderingMode,lineWidth}=stack.pop());
      else if(op===O.setFillRGBColor)fill=rgb(a[0],a[1],a[2]);
      else if(op===O.setFillGray)fill=rgb(a[0],a[0],a[0]);
      else if(op===O.setFillCMYKColor)fill=cmyk(a[0],a[1],a[2],a[3]);
      else if(op===O.setStrokeRGBColor)stroke=rgb(a[0],a[1],a[2]);
      else if(op===O.setStrokeGray)stroke=rgb(a[0],a[0],a[0]);
      else if(op===O.setStrokeCMYKColor)stroke=cmyk(a[0],a[1],a[2],a[3]);
      else if(op===O.setTextRenderingMode)renderingMode=Number(a[0])||0;
      else if(op===O.setLineWidth)lineWidth=Math.abs(Number(a[0]))||0;
      else if(op===O.setFont){fontName=String(a[0]||"");fontSize=Math.abs(Number(a[1]))||0;}
      else if(op===O.showText||op===O.showSpacedText){
        const text=glyphText(a[0]);
        const metrics=glyphMetrics(a[0]);
        if(text)runs.push({text,color:{...fill},strokeColor:{...stroke},fontName,fontSize,renderingMode,
          renderingModeName:renderingModeName(renderingMode),lineWidth,...metrics,operatorIndex:i});
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
      const result=run?{...run,color:{...run.color},strokeColor:{...run.strokeColor}}:
        {color:rgb(0,0,0),strokeColor:rgb(0,0,0),fontName:"",fontSize:0,operatorIndex:-1,text:"",
          renderingMode:0,renderingModeName:"fill",lineWidth:1,glyphWidth:0,glyphCount:0};
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
  function fontDetails(page,fontName){
    let font;
    try{font=page.commonObjs.get(fontName);}catch{return {};}
    if(!font)return {};
    return {
      loadedName:font.loadedName||"",originalName:font.name||font.systemFontInfo?.baseFontName||"",
      fallbackName:font.fallbackName||"",fontWeight:String(font.fontWeight||font.cssFontInfo?.fontWeight||""),
      bold:font.bold===true,black:font.black===true,isType3Font:font.isType3Font===true,
      fontType:font.type||"",fontSubtype:font.subtype||"",vertical:font.vertical===true,
      disableFontFace:font.disableFontFace===true,embeddedFontBytes:font.data?.length||0
    };
  }
  async function analyzePage(page,pageNumber){
    const [text,ops]=await Promise.all([page.getTextContent(),page.getOperatorList()]);
    const mapped=mapColors(text.items,operatorPaintRuns(ops));
    const sizes=text.items.filter(i=>i.str.trim()).map(i=>Math.hypot(i.transform[2],i.transform[3])||Math.abs(i.height));
    const bodySize=median(sizes.filter(Boolean));
    const entries=text.items.map((item,index)=>{
      const style=text.styles[item.fontName]||{},paint=mapped[index];
      const details=fontDetails(page,item.fontName);
      const font=[item.fontName,style.fontFamily,paint.fontName,details.loadedName,details.originalName,details.fallbackName].filter(Boolean).join(" / ");
      const size=Math.hypot(item.transform[2],item.transform[3])||Math.abs(item.height)||paint.fontSize;
      const explicitBold=details.bold||details.black||Number.parseInt(details.fontWeight,10)>=600||/(bold|semibold|demibold|heavy|black|太ゴ|中ゴ|角ゴ)/i.test(font);
      const colorType=classifyColor(paint.color);
      const bodySized=bodySize===0||(size>=bodySize*.72&&size<=bodySize*1.35);
      return {text:item.str,pageNumber,x:item.transform[4],y:item.transform[5],width:item.width,height:item.height,
        fontName:item.fontName,fontFamily:style.fontFamily||"",operatorFontName:paint.fontName,fontSize:size,
        explicitBold,color:paint.color,strokeColor:paint.strokeColor,colorType,bodySized,bodySize,
        operatorIndex:paint.operatorIndex,renderingMode:paint.renderingMode,renderingModeName:paint.renderingModeName,
        fillStroke:paint.renderingModeName,lineWidth:paint.lineWidth,glyphWidth:paint.glyphWidth||0,glyphCount:paint.glyphCount||0,
        normalizedAdvance:item.str.length?item.width/size/[...item.str].length:0,samePositionDrawCount:1,
        fontDetails:details,transform:item.transform};
    });
    // Synthetic bold is often produced by stroking text or drawing the same glyph twice at the same position.
    const positionCounts=new Map();
    for(const entry of entries){
      const key=`${entry.text}\u0000${Math.round(entry.x*2)}\u0000${Math.round(entry.y*2)}`;
      positionCounts.set(key,(positionCounts.get(key)||0)+1);
    }
    for(const entry of entries){
      const key=`${entry.text}\u0000${Math.round(entry.x*2)}\u0000${Math.round(entry.y*2)}`;
      entry.samePositionDrawCount=positionCounts.get(key)||1;
      const syntheticBold=[1,2,5,6].includes(entry.renderingMode)||entry.samePositionDrawCount>1;
      entry.boldEvidence=[entry.explicitBold&&"font-metadata/name",[1,2,5,6].includes(entry.renderingMode)&&"text-stroke",entry.samePositionDrawCount>1&&"same-position-repeat"].filter(Boolean).join("+")||"none";
      entry.bold=entry.explicitBold||syntheticBold;
      entry.category=entry.colorType==="red"?"red":entry.colorType==="blue"?"blue":
        (entry.colorType==="black"&&entry.bold&&entry.bodySized?"blackBold":null);
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
    const diagnostic=e=>({text:e.text,fontName:e.fontName,fontFamily:e.fontFamily,operatorFontName:e.operatorFontName,
      fontSize:Number(e.fontSize.toFixed(2)),color:colorText(e.color),strokeColor:colorText(e.strokeColor),
      operatorIndex:e.operatorIndex,"fill/stroke":e.fillStroke,renderingMode:e.renderingMode,
      glyphWidth:Number(e.glyphWidth.toFixed(2)),normalizedAdvance:Number(e.normalizedAdvance.toFixed(3)),
      "same-position draw count":e.samePositionDrawCount,boldEvidence:e.boldEvidence,...e.fontDetails});
    for(const e of candidates){
      lines.push(`${{red:"赤文字",blue:"青文字",blackBold:"黒太字"}[e.category]}候補: ${JSON.stringify(e.text)}`,
        `page=${e.pageNumber} x=${e.x.toFixed(2)} y=${e.y.toFixed(2)} width=${e.width.toFixed(2)} height=${e.height.toFixed(2)}`,
        `font=${e.fontName}${e.fontFamily?` (${e.fontFamily})`:""} operatorFont=${e.operatorFontName} size=${e.fontSize.toFixed(2)} bold=${e.bold}`,
        `color=${colorText(e.color)} mode=${e.renderingModeName} glyphWidth=${e.glyphWidth.toFixed(2)} repeat=${e.samePositionDrawCount} evidence=${e.boldEvidence} operatorIndex=${e.operatorIndex}`,"");
    }
    $("pdfReport").textContent=lines.join("\n");
    $("pdfReportPanel").classList.remove("hidden");
    const black=entries.filter(e=>e.colorType==="black"&&e.text.trim());
    console.group("PDF重要語句 技術検証");
    console.table(candidates.map(diagnostic));console.log(lines.join("\n"));
    console.group("黒太字候補（全件）");console.table(black.filter(e=>e.category==="blackBold").map(diagnostic));console.groupEnd();
    console.group("通常黒文字（比較用・先頭20件）");console.table(black.filter(e=>e.category!=="blackBold").slice(0,20).map(diagnostic));console.groupEnd();
    console.group("黒文字フォント一覧");console.table([...new Map(black.map(e=>[`${e.fontName}/${e.operatorFontName}`,diagnostic(e)])).values()]);console.groupEnd();
    console.groupEnd();
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
      // fontExtraProperties exposes descriptor/type/subset details needed to compare anonymous embedded fonts.
      state.pdf=await window.pdfjsLib.getDocument({data:state.buffer,fontExtraProperties:true}).promise;
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
