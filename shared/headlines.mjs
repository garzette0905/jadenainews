import edits from './headline-edits.json' with {type:'json'};
export function headlineFingerprint(title,summary){let h=2166136261;for(const c of String(title||'').trim()+'\n'+String(summary||'').slice(0,220))h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16);}
export function editorialHeadline(a){
  const edit=edits[a.url];
  if(edit&&edit.fingerprint===headlineFingerprint(a.title||a.titleKo,a.summary))return edit.title;
  let title=String(a.titleKo||a.title||'').replace(/\s*(?:- AI타임스|\| TechCrunch)$/i,'');
  // Literal translations of existing recurring English headlines; never add performance claims.
  const original=String(a.title||title);
  if(/NVIDIA Opens Vera Rubin Architecture/i.test(original))return 'NVIDIA, AI 데이터센터용 Vera Rubin 설계 공개';
  if(/Introducing Muse Wonder and Muse Wonder Full/i.test(original))return 'Meta, AI 에이전트용 Muse Wonder·Wonder Full 공개';
  if(/Meta releases its first frontier model, Muse Wonder/i.test(original))return 'Meta, 새 AI 모델 Muse Wonder 공개';
  if(/Meta has some Wonder Full new AI models/i.test(original))return 'Meta, 새 AI 모델 Muse Wonder·Wonder Full 공개';
  const names={'마이크로소프트':'Microsoft','오픈AI':'OpenAI','오픈에이아이':'OpenAI','앤트로픽':'Anthropic','엔비디아':'NVIDIA','구글':'Google','메타':'Meta','어도비':'Adobe','퀄컴':'Qualcomm','아마존웹서비스':'AWS','아마존':'Amazon','테런스 타오':'Terence Tao','사티아 나델라':'Satya Nadella','나델라':'Satya Nadella','브래드 스미스':'Brad Smith','보리스 체르니':'Boris Cherny'};
  for(const [ko,en]of Object.entries(names))title=title.replace(new RegExp(ko+'(?=$|[\\s,·‘’"…]|의|가|는|를|와|에)','g'),en);
  return title;
}
export function headlineInstructions(){return `제목 작성: 독자는 IT 기획자입니다. titleKo는 쉬운 한국어로 누가 무엇을 바꿨고 어떤 업무에 쓰이는지 한눈에 이해되는 30~65자 안팎의 제목으로 작성하십시오. 기술 용어 나열, 과도한 수식어, 번역투, 낚시성 표현은 피하고 원문의 구체적인 변화·활용을 먼저 말하십시오. 추론은 AI 응답 처리, 컨텍스트는 읽을 수 있는 문서 길이, 피지컬 AI는 로봇·현장 AI처럼 필요한 경우 풀어 쓰십시오. 영어권 회사·인물 이름은 정확한 영어 표기(Microsoft, Anthropic, Satya Nadella 등), 비영어권 회사·인물은 한글 표기를 사용합니다. 출시·계획·협상·회사 주장·미확인 상태를 구분하고 제목에 없는 성과나 효능을 추가하지 마십시오. title은 원문 그대로 보존합니다.`;}
