// A user-triggered copy must also work in portal frames that deny the async API.
export async function copyText(text,{navigator=globalThis.navigator,document=globalThis.document}={}){
  try{if(navigator?.clipboard?.writeText){await navigator.clipboard.writeText(text);return true;}}catch{}
  let field;
  const focus=document?.activeElement,selection=document?.getSelection?.();
  const ranges=selection?Array.from({length:selection.rangeCount},(_,i)=>selection.getRangeAt(i).cloneRange()):[];
  try{
    if(!document?.execCommand)return false;
    field=document.createElement('textarea');field.value=text;field.readOnly=true;
    field.style.cssText='position:fixed;left:-9999px;top:0;font-size:16px;';
    document.body.append(field);field.focus();field.select();field.setSelectionRange(0,text.length);
    return document.execCommand('copy')===true;
  }catch{return false;}
  finally{
    field?.remove();focus?.focus?.({preventScroll:true});
    if(selection){selection.removeAllRanges();for(const range of ranges)selection.addRange(range);}
  }
}
