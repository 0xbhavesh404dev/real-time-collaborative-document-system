import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from '@oai/artifact-tool';
import { pathToFileURL } from 'node:url';

const root = '/Users/bhaveshkumar/Downloads/real-time-collaborative-2 with ai integrated';
const skill = '/Users/bhaveshkumar/.codex/plugins/cache/openai-primary-runtime/presentations/26.1007.11041/skills/presentations';
const stage = path.join(root, '.build-pptx');
const output = path.join(root, 'deliverables');
const finalPath = path.join(output, 'Real_Time_Collaborative_Document_System_v8.pptx');
await fs.mkdir(stage, { recursive: true });
await fs.mkdir(output, { recursive: true });

const W=1280,H=720;
const C={teal:'#24B8B2', tealDark:'#138C88', black:'#242424', ink:'#202020', muted:'#525252', pale:'#EAF7F6', line:'#383838', white:'#FFFFFF', gray:'#F1F1F1'};
const FONT='Arial';
const deck=Presentation.create({slideSize:{width:W,height:H}});

function shape(slide, geometry, x,y,w,h, fill='none', lineFill='none', lineWidth=0, name='') {
  return slide.shapes.add({geometry,name,position:{left:x,top:y,width:w,height:h},fill,line:{style:'solid',fill:lineFill,width:lineWidth}});
}
function text(slide, value, x,y,w,h, opts={}) {
  const s=shape(slide,'textbox',x,y,w,h,'none','none',0,opts.name||'');
  s.text=value;
  s.text.style={typeface:FONT,fontSize:opts.size||21,bold:!!opts.bold,color:opts.color||C.ink,alignment:opts.align||'left',verticalAlignment:opts.valign||'middle',wrap:true};
  s.text.insets=opts.insets??0;
  return s;
}
function addSlide(title, num) {
  const slide=deck.slides.add(); slide.background.fill=C.white;
  shape(slide,'rect',0,0,W,76,C.teal,'none',0,'header-band');
  text(slide,title,42,13,1180,50,{size:29,bold:true,color:C.white});
  shape(slide,'rect',0,690,W,30,C.black,'none',0,'footer-band');
  text(slide,'DBMS Project — Review 3',38,693,340,22,{size:13,color:C.white});
  text(slide,String(num),1208,693,34,22,{size:13,color:C.white,align:'right'});
  return slide;
}
function paragraph(slide, lines, x,y,w, size=21, gap=44, color=C.ink) {
  lines.forEach((line,i)=>text(slide,line,x,y+i*gap,w,gap-4,{size,color}));
}
function section(slide, heading, body, x,y,w, bodySize=20) {
  text(slide,heading,x,y,w,32,{size:22,bold:true,color:C.tealDark});
  text(slide,body,x,y+39,w,98,{size:bodySize,color:C.ink,valign:'top'});
}
function bullet(slide, str, x,y,w,h=32,size=20) {
  text(slide,'•',x,y,18,h,{size:size+1,color:C.tealDark,bold:true});
  text(slide,str,x+25,y,w-25,h,{size,color:C.ink,valign:'top'});
}
function box(slide, label, sub, x,y,w,h, opts={}) {
  const b=shape(slide,'rect',x,y,w,h,opts.fill||C.white,opts.stroke||C.line,opts.strokeWidth||1.4,label);
  text(slide,label,x+10,y+9,w-20,27,{size:opts.size||19,bold:true,align:'center',color:opts.color||C.ink});
  if(sub) text(slide,sub,x+12,y+43,w-24,h-51,{size:opts.subSize||15,align:'center',color:opts.subColor||C.muted,valign:'top'});
  return b;
}
function arrow(slide, from, to, side='right', targetSide='left', color=C.line, kind='straight') {
  return slide.shapes.connect(from,to,{kind,fromSide:side,toSide:targetSide,line:{style:'solid',fill:color,width:2},tail:{type:'arrow',width:'med',length:'med'}});
}

// 1. Cover, adapted from the supplied Review 3 cover.
{
  const s=deck.slides.add(); s.background.fill=C.teal;
  text(s,'Real-Time Collaborative\nDocument Management System',56,120,1110,174,{size:50,bold:true,color:C.white,valign:'middle'});
  text(s,'DBMS Project — Review 3',60,315,760,52,{size:31,bold:true,color:C.black});
  shape(s,'rect',0,565,W,155,C.black,'none',0,'team-footer');
  text(s,'Yusuf Shereef\nBhavesh Kumar\nMadamshetty Pruthvi\nSyed Mohammed Faizan',48,578,500,128,{size:19,color:C.white,valign:'middle'});
}

// 2. Problem and project goal
{
  const s=addSlide('Problem and project goal',2);
  section(s,'The problem','When two people edit a shared document, saving a whole new copy can replace someone else’s recent work.',60,130,510);
  section(s,'What we built','A browser based document system where edits travel as small operations, merge on the server, and appear for collaborators.',670,130,540);
  shape(s,'line',640,145,0,360,'none','#B9D8D6',1);
  text(s,'Project goal',60,365,230,34,{size:22,bold:true,color:C.tealDark});
  text(s,'Keep a shared document consistent while people edit at the same time, with saved history and role based access.',60,409,1100,94,{size:27,bold:true,color:C.ink,valign:'top'});
  text(s,'The project also demonstrates how a relational database supports users, workspaces, documents, edit history and permissions.',60,542,1090,65,{size:19,color:C.muted,valign:'top'});
}

// 3. How the project was made
{
  const s=addSlide('Technical competence: how we built the project',3);
  text(s,'We built the application in layers so each part has a clear job.',56,113,1120,40,{size:23,color:C.muted});
  section(s,'Browser','React and Vite provide the document editor, formatting controls, channel pages and AI writing panel.',60,194,345,19);
  section(s,'Application server','Node.js and Express handle sign in, channels, permissions and saved document versions.',465,194,345,19);
  section(s,'Live collaboration','Socket.IO carries edit operations and presence updates between people in the same document.',870,194,345,19);
  shape(s,'line',58,385,1160,0,'none','#B9D8D6',1);
  text(s,'Data and implementation choices',60,414,500,35,{size:22,bold:true,color:C.tealDark});
  bullet(s,'PostgreSQL stores accounts, memberships, documents, operation history and saved versions.',60,463,1090,35,20);
  bullet(s,'A small character based CRDT was written for this project instead of using a ready made CRDT package.',60,509,1090,55,20);
  bullet(s,'The team connected the editor to the API and socket events, then checked the CRDT behavior with automated tests.',60,571,1090,52,20);
}

// 4. Full application workflow
{
  const s=addSlide('Final system workflow',4);
  text(s,'From sign-in to a shared, saved document, including the project’s AI and language services.',55,96,1170,33,{size:19,color:C.muted});
  const users=box(s,'Users','Sign in; join a channel; open a document',42,142,205,104,{fill:C.pale,size:19,subSize:14});
  const app=box(s,'React interface','Edit, format and request writing help',286,142,205,104,{fill:C.white,size:19,subSize:14});
  const server=box(s,'Express + Socket.IO','Checks identity and role; handles REST and live events',530,142,205,104,{fill:C.white,size:18,subSize:14});
  const crdt=box(s,'TextCRDT','Applies insert/delete operations; orders concurrent edits',774,142,205,104,{fill:C.pale,size:18,subSize:14});
  const db=box(s,'PostgreSQL','Accounts, channels, documents, operations and versions',1018,142,205,104,{fill:C.white,size:18,subSize:14});
  arrow(s,users,app); arrow(s,app,server); arrow(s,server,crdt); arrow(s,crdt,db);
  const management=box(s,'Document management','Channel membership and role checks  •  document load/save  •  version history  •  preview and restore',55,290,550,103,{fill:C.gray,size:19,subSize:15});
  const aiRequest=box(s,'Writing and language request','The editor sends grammar, similarity or writing actions through the application server.',675,290,550,103,{fill:C.gray,size:19,subSize:15});
  arrow(s,server,management,'bottom','right',C.tealDark,'straight');
  arrow(s,server,aiRequest,'bottom','left',C.tealDark,'straight');
  const localTools=box(s,'Local language services','LanguageTool checks grammar; a local TF-IDF corpus checks similarity. If LanguageTool is down, one Gemini grammar fallback is attempted with a cooldown.',55,434,550,104,{fill:C.white,size:18,subSize:14});
  const gemini=box(s,'Gemini API','The server keeps GEMINI_API_KEY private and sends improve, paraphrase, summarize, translate and autocomplete requests. No local generative LLM is included.',675,434,550,104,{fill:C.pale,size:18,subSize:14});
  arrow(s,aiRequest,localTools,'left','right',C.tealDark,'straight');
  arrow(s,aiRequest,gemini,'bottom','top',C.tealDark,'straight');
  text(s,'REST returns documents, versions and AI responses. Socket.IO broadcasts accepted edits to connected collaborators.',70,550,1140,24,{size:16,color:C.ink,align:'center'});
  const result=box(s,'Shared outcome','Authorized edits converge through TextCRDT, persist in PostgreSQL and appear in each collaborator’s document.',190,584,900,76,{fill:C.pale,size:18,subSize:14});
  text(s,'Evaluation: 13 CRDT unit tests; demonstrate concurrent editing in two sessions.',220,665,840,20,{size:14,color:C.muted,align:'center'});
}

// 5. AI and language workflow
{
  const s=addSlide('AI and language tools',5);
  text(s,'The editor sends each request to the service that provides that feature.',55,100,1170,34,{size:20,color:C.muted});
  const editor=box(s,'Editor request','Grammar, similarity or an AI writing action',58,177,240,110,{fill:C.pale,size:19,subSize:15});
  const local=box(s,'Local services','LanguageTool checks grammar; local TF-IDF corpus checks text similarity. If LanguageTool is unavailable, one Gemini grammar fallback is attempted with a cooldown.',390,148,335,145,{fill:C.white,size:19,subSize:15});
  const api=box(s,'App server','Keeps GEMINI_API_KEY private; applies per-user rate limits',390,333,335,128,{fill:C.white,size:19,subSize:15});
  const gemini=box(s,'Gemini API','Improve, paraphrase, summarize, translate and autocomplete',824,333,335,128,{fill:C.pale,size:19,subSize:15});
  arrow(s,editor,local,'right','left',C.tealDark,'straight');
  arrow(s,editor,api,'right','left',C.line,'straight');
  arrow(s,api,gemini,'right','left',C.line,'straight');
  const fallback=box(s,'When Gemini is unavailable','Summary shows an extractive preview. Autocomplete returns no text. Paraphrase and translation show an unavailable message. There is no local generative LLM fallback in this build.',190,507,900,105,{fill:C.gray,size:18,subSize:15});
  arrow(s,gemini,fallback,'bottom','right',C.tealDark,'straight');
  text(s,'GitHub Pages can host the browser interface only. The API server, database and LanguageTool service must be hosted separately; configure LANGUAGETOOL_URL to reach that service.',58,631,1165,42,{size:15,color:C.muted,align:'center'});
}

// 6. Database design
{
  const s=addSlide('Database design',6);
  text(s,'PostgreSQL keeps the project’s records connected with foreign keys.',56,108,1150,38,{size:22,color:C.muted});
  const rows=[
    ['users','Account identity and password hash'],
    ['channels + channel_members','Shared spaces and each member’s role'],
    ['documents','Current text, formatted content and CRDT state'],
    ['document_operations','Accepted insert / delete operations'],
    ['versions','Manual snapshots with author and time'],
    ['invitations','Pending or completed channel invitations']
  ];
  rows.forEach((r,i)=>{
    const y=174+i*65;
    if(i%2===0) shape(s,'rect',52,y,1165,54,C.gray,'none',0);
    text(s,r[0],70,y+5,330,42,{size:19,bold:true,color:C.tealDark});
    text(s,r[1],425,y+5,760,42,{size:19,color:C.ink});
  });
  text(s,'A channel has many members and documents. A document has many operations and versions.',65,590,1120,38,{size:21,bold:true,color:C.ink,align:'center'});
  text(s,'The schema uses unique constraints and indexes for memberships, operation IDs, document lists and version history.',65,633,1120,32,{size:17,color:C.muted,align:'center'});
}

// 6. CRDT example
{
  const s=addSlide('How simultaneous edits are reconciled',7);
  text(s,'Each inserted character has an ID and a reference to the character before it. Deletes leave a tombstone.',56,108,1150,54,{size:21,color:C.muted});
  text(s,'Starting text',72,205,250,32,{size:21,bold:true,color:C.tealDark});
  text(s,'A',72,245,230,66,{size:36,bold:true});
  text(s,'Two people insert after A at nearly the same time',372,205,760,32,{size:21,bold:true,color:C.tealDark});
  shape(s,'rect',372,248,325,80,C.pale,C.tealDark,1.2);
  text(s,'User 1: insert X after A\noperation ID: user1:1',391,258,285,60,{size:19,color:C.ink});
  shape(s,'rect',742,248,325,80,C.pale,C.tealDark,1.2);
  text(s,'User 2: insert Y after A\noperation ID: user2:1',761,258,285,60,{size:19,color:C.ink});
  text(s,'Both replicas receive both operations. The CRDT sorts concurrent siblings by operation ID, so delivery order does not decide the result.',72,391,1070,76,{size:22,color:C.ink,valign:'top'});
  text(s,'Shared result',72,508,250,34,{size:21,bold:true,color:C.tealDark});
  text(s,'AXY',72,548,300,67,{size:40,bold:true,color:C.ink});
  text(s,'A deleted character stays internally as a tombstone so later operations can still refer to its ID.',430,552,710,58,{size:19,color:C.muted,valign:'top'});
}

// 7. Feature walkthrough
{
  const s=addSlide('What a user can do',8);
  const cols=[
    {x:58,h:'Work together',items:['Create channels and shared documents','See who is in a document','Edit live with other collaborators']},
    {x:465,h:'Manage access',items:['Assign admin, editor or viewer roles','Check permissions on the server','Invite and manage channel members']},
    {x:872,h:'Manage documents',items:['Format text in the editor','Save and preview versions','Restore an earlier snapshot']}
  ];
  cols.forEach(c=>{
    text(s,c.h,c.x,153,340,38,{size:23,bold:true,color:C.tealDark});
    c.items.forEach((it,i)=>bullet(s,it,c.x,214+i*78,340,62,19));
  });
  shape(s,'line',430,146,0,390,'none','#B9D8D6',1); shape(s,'line',837,146,0,390,'none','#B9D8D6',1);
  text(s,'Viewers can read; admins and editors can make changes. The server enforces the same rule for API and socket actions.',62,568,1150,57,{size:20,bold:true,color:C.ink,align:'center'});
}

// 8. Novelty and adaptability
{
  const s=addSlide('Innovative and sustainable features',9);
  text(s,'The main contribution is the way the project combines document management with a custom, inspectable collaboration method.',56,107,1155,55,{size:21,color:C.muted});
  text(s,'What is new in this project',62,200,500,36,{size:23,bold:true,color:C.tealDark});
  bullet(s,'Edits are represented as operations instead of replacing the whole text.',62,250,520,58,20);
  bullet(s,'The CRDT logic is small enough to inspect and explain in a DBMS project.',62,326,520,58,20);
  bullet(s,'Operation history and manual versions make changes easier to review.',62,402,520,58,20);
  shape(s,'line',632,190,0,318,'none','#B9D8D6',1);
  text(s,'How it adapts',685,200,500,36,{size:23,bold:true,color:C.tealDark});
  bullet(s,'More collaborators join through document rooms and channel membership.',685,250,520,58,20);
  bullet(s,'New document features can use the existing API, role checks and tables.',685,326,520,58,20);
  bullet(s,'Future changes can add tables or modules without changing the core edit flow.',685,402,520,62,20);
  text(s,'Current scope: one server keeps active CRDTs in memory; this project does not provide offline multi-server synchronization.',63,548,1145,65,{size:18,color:C.muted,align:'center'});
}

// 9. Evaluation and results
{
  const s=addSlide('Accuracy of results',10);
  text(s,'We checked correctness at the operation level and build readiness at the application level.',55,108,1170,36,{size:21,color:C.muted});
  const heads=['Check','What it verifies','Result'];
  const xs=[65,350,875], ws=[255,500,335];
  shape(s,'rect',55,168,1170,48,C.teal,'none',0);
  heads.forEach((h,i)=>text(s,h,xs[i],174,ws[i],36,{size:18,bold:true,color:C.white}));
  const cases=[
    ['CRDT unit tests','Insert, delete, duplicate IDs, pending dependencies, deterministic order','13 tests pass'],
    ['Frontend production build','React and Vite compile the client bundle','Build succeeds'],
    ['Two-user manual check','Open one document twice and compare final text after edits','Use for live demo'],
    ['Role checks','Viewer cannot edit; editor/admin can modify','Verify in demo']
  ];
  cases.forEach((r,i)=>{
    const y=216+i*79; if(i%2===0) shape(s,'rect',55,y,1170,78,C.gray,'none',0);
    r.forEach((v,j)=>text(s,v,xs[j],y+8,ws[j]-10,62,{size:17,bold:j===0,color:C.ink,valign:'middle'}));
  });
  text(s,'These checks support the project’s functional claims. They are not a load test or a production reliability study.',66,568,1140,51,{size:18,color:C.muted,align:'center'});
}

// 10. Utility and sustainability
{
  const s=addSlide('Utility to society',11);
  section(s,'Practical use','A small team can draft and review one shared document without sending files back and forth.',66,150,500,20);
  section(s,'Learning value','Students can inspect how relational data, permissions, live events and conflict handling fit together.',670,150,520,20);
  shape(s,'line',632,155,0,250,'none','#B9D8D6',1);
  text(s,'Sustainable development path',66,395,520,38,{size:23,bold:true,color:C.tealDark});
  bullet(s,'The current system uses open source tools and a small database schema.',66,445,530,49,19);
  bullet(s,'The modular API leaves room for comments, offline support or more document types.',66,502,530,58,19);
  text(s,'Limits to explain honestly',670,395,520,38,{size:23,bold:true,color:C.tealDark});
  bullet(s,'The custom CRDT is educational and runs on one application server.',670,445,530,49,19);
  bullet(s,'The originality panel checks against a bundled local corpus; it is not web wide plagiarism detection.',670,502,540,70,19);
}

// 12. Dissemination, accessibility and demonstration
{
  const s=addSlide('Presentation skills',12);
  text(s,'The system is easiest to explain by following one edit from the browser to another user.',58,112,1140,48,{size:22,color:C.muted});
  const steps=[
    ['1','Sign in','Show account access and channel roles'],
    ['2','Open a document','Show the editor and saved content'],
    ['3','Edit in two sessions','Watch the second view receive the operation'],
    ['4','Save and restore','Preview an older version, then restore it']
  ];
  steps.forEach((step,i)=>{
    const y=202+i*91;
    text(s,step[0],66,y,52,50,{size:25,bold:true,color:C.tealDark,align:'center'});
    text(s,step[1],145,y,260,40,{size:22,bold:true,color:C.ink});
    text(s,step[2],425,y,760,48,{size:20,color:C.ink});
    if(i<3) shape(s,'line',92,y+51,0,33,'none','#9BCFCD',1.5);
  });
  text(s,'For accessibility, use a clear spoken sequence, readable text and a live demonstration with prepared accounts and documents.',68,591,1125,56,{size:18,color:C.muted,align:'center'});
}

// 12. Conclusion
{
  const s=addSlide('Conclusion',13);
  text(s,'The project demonstrates a complete path from a user’s edit to a shared, stored document.',60,130,1120,76,{size:31,bold:true,color:C.ink,valign:'top'});
  bullet(s,'The server checks who can edit before it accepts live operations.',73,264,1100,42,22);
  bullet(s,'The custom CRDT gives replicas a deterministic way to converge.',73,324,1100,42,22);
  bullet(s,'PostgreSQL stores the document state and its history for later review.',73,384,1100,42,22);
  text(s,'The result is a working educational system that makes its database and collaboration choices visible and explainable.',62,492,1110,90,{size:23,color:C.tealDark,bold:true,valign:'top'});
}

const draft=path.join(stage,'draft.pptx');
const pptx=await PresentationFile.exportPptx(deck); await pptx.save(draft);
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const receipt=path.join(stage,'validation-v8.json');
const result=await finalizePresentation({
  workspaceDir:root,candidatePath:draft,finalPath,
  pythonExecutable:'/Users/bhaveshkumar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
  integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],
  requirements:{explicitTotalSlideCount:13,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[]},
  fontPolicy:{basis:'design',families:[FONT]},verifyArtifactToolImport:true,receiptPath:receipt,
});
console.log(JSON.stringify({finalPath,receipt,result},null,2));
