/* ============================================================
   Dartloggen — stemmegjenkjenning
   Delt motor. Både appen (index.html) og innlesingssiden
   (lydtrening.html) bruker denne, så det du stiller inn og tester ett
   sted oppfører seg likt det andre.
   Ingen nedlasting, ingen server — alt skjer på telefonen.
   ============================================================ */
(function(){
"use strict";

/* ============================================================
   1. SIGNALBEHANDLING
   ============================================================ */
const P = { sampleRate:16000, frameLen:400, hop:160, fftSize:512,
            melBands:26, cepstra:13, fMin:200, fMax:7000 };

function fft(re, im){
  const n = re.length;
  for(let i=1, j=0; i<n; i++){
    let bit = n>>1;
    for(; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if(i<j){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; }
  }
  for(let len=2; len<=n; len<<=1){
    const ang = -2*Math.PI/len, wr = Math.cos(ang), wi = Math.sin(ang);
    for(let i=0; i<n; i+=len){
      let cr=1, ci=0;
      for(let k=0; k<len/2; k++){
        const ar=re[i+k], ai=im[i+k];
        const br=re[i+k+len/2], bi=im[i+k+len/2];
        const tr=br*cr-bi*ci, ti=br*ci+bi*cr;
        re[i+k]=ar+tr; im[i+k]=ai+ti;
        re[i+k+len/2]=ar-tr; im[i+k+len/2]=ai-ti;
        const ncr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=ncr;
      }
    }
  }
}
const hzToMel = f => 2595*Math.log10(1+f/700);
const melToHz = m => 700*(Math.pow(10,m/2595)-1);
const MEL = (function(){
  const bins = P.fftSize/2+1, lo = hzToMel(P.fMin), hi = hzToMel(P.fMax), pts=[];
  for(let i=0;i<P.melBands+2;i++)
    pts.push(Math.floor((P.fftSize+1)*melToHz(lo+(hi-lo)*i/(P.melBands+1))/P.sampleRate));
  const out=[];
  for(let m=1;m<=P.melBands;m++){
    const f=new Float32Array(bins), a=pts[m-1], b=pts[m], c=pts[m+1];
    for(let k=a;k<b;k++) if(k>=0&&k<bins&&b>a) f[k]=(k-a)/(b-a);
    for(let k=b;k<c;k++) if(k>=0&&k<bins&&c>b) f[k]=(c-k)/(c-b);
    out.push(f);
  }
  return out;
})();
const HANN = (function(){
  const w=new Float32Array(P.frameLen);
  for(let i=0;i<P.frameLen;i++) w[i]=0.5-0.5*Math.cos(2*Math.PI*i/(P.frameLen-1));
  return w;
})();
function dct(input, keep){
  const n=input.length, out=new Float32Array(keep);
  for(let k=0;k<keep;k++){
    let s=0;
    for(let i=0;i<n;i++) s += input[i]*Math.cos(Math.PI*k*(i+0.5)/n);
    out[k]=s;
  }
  return out;
}
const _re = new Float32Array(P.fftSize), _im = new Float32Array(P.fftSize);
const _bins = P.fftSize/2+1;
// Én ramme på 25 ms -> mel-spekter (til spektrogrammet), MFCC og energi
function frameFeature(buf, off){
  _re.fill(0); _im.fill(0);
  for(let i=0;i<P.frameLen;i++) _re[i]=buf[off+i]*HANN[i];
  fft(_re,_im);
  const mel=new Float32Array(P.melBands);
  for(let m=0;m<P.melBands;m++){
    let s=0; const f=MEL[m];
    for(let k=0;k<_bins;k++){
      const p=(_re[k]*_re[k]+_im[k]*_im[k])/P.fftSize;
      s += p*f[k];
    }
    mel[m]=Math.log(s+1e-10);
  }
  let e=0;
  for(let m=0;m<P.melBands;m++) e+=mel[m];
  return { mfcc: dct(mel,P.cepstra), mel: mel, energy: e/P.melBands };
}
// Trekk fra snittet: gjør sammenligningen upåvirket av mikrofon og avstand
function cmn(frames){
  if(!frames.length) return frames;
  const n=frames[0].mfcc.length, mean=new Float32Array(n);
  frames.forEach(f=>{ for(let i=0;i<n;i++) mean[i]+=f.mfcc[i]; });
  for(let i=0;i<n;i++) mean[i]/=frames.length;
  return frames.map(f=>{
    const v=new Float32Array(n);
    for(let i=0;i<n;i++) v[i]=f.mfcc[i]-mean[i];
    return { mfcc:v };
  });
}
function dist(a,b){
  let s=0;
  for(let i=0;i<a.length;i++){ const d=a[i]-b[i]; s+=d*d; }
  return Math.sqrt(s);
}
// DTW: strekker tid, så tempo ikke spiller inn. «cutoff» lar oss gi opp tidlig.
function dtw(A,B,bandFrac,cutoff){
  const n=A.length, m=B.length;
  if(!n||!m) return Infinity;
  const norm=n+m;
  const band=Math.max(Math.abs(n-m)+1, Math.ceil((bandFrac||0.2)*Math.max(n,m)));
  let prev=new Float64Array(m+1).fill(Infinity), cur=new Float64Array(m+1);
  prev[0]=0;
  for(let i=1;i<=n;i++){
    cur.fill(Infinity);
    const jLo=Math.max(1,i-band), jHi=Math.min(m,i+band);
    let rowMin=Infinity;
    const a=A[i-1].mfcc;
    for(let j=jLo;j<=jHi;j++){
      const v=dist(a,B[j-1].mfcc)+Math.min(prev[j],cur[j-1],prev[j-1]);
      cur[j]=v;
      if(v<rowMin) rowMin=v;
    }
    if(cutoff!=null && rowMin/norm > cutoff) return Infinity;
    const t=prev; prev=cur; cur=t;
  }
  return prev[m]/norm;
}

const WORDS = ["treff","bom","dobbel","trippel","angre"];
const TARGET = 8;
const STORE = "dart_voice_templates";
const SNIPKEY = "dart_voice_snips";
const CFGKEY = "dart_voice_cfg";
const MINSEG = 8;      // kortere enn 80 ms er ikke et ord

/* ---- orddeteksjon ------------------------------------------------------
   Tilstandsmaskin: mates med energi per ramme, sier fra når et ord er ferdig.
   Fri for DOM og mikrofon, så den kan testes i Node.

   Tre ting holder den i sjakk i et stille rom:

   1) Gulvet spores med faste små skritt, og oppover ti ganger tregere enn
      nedover. Da legger det seg på omtrent 9. persentil av romlyden — altså
      ekte stillhet — uten å jage hvert enkelt støyminimum, og uten å krype
      oppover mens du snakker.
   2) Ett enkelt sprett er aldri et ord. Det kreves to rammer på rad over
      terskelen, og det gjør et falskt utslag usannsynlig i annen potens.
   3) Etter hvert ord er det en sperre på et halvt sekund. Halen av ordet,
      ekkoet i rommet og pusten etterpå rekker ikke å bli et nytt utslag.

   Selve terskelen er brukerens, ikke min. Jeg forsøkte først å heve den
   automatisk når rommet svingte mye — men det målet lot seg bare beregne av
   lyden som kom inn, og da talte ordet ditt med: terskelen steg FORDI du
   snakket, og ordet ble aldri utløst. «sd» måles fortsatt, men bare for å
   vises på skjermen og for å foreslå en verdi når du måler rommet.          */
function makeEndpointer(cfg){
  const C = Object.assign({ start:2.5, endMin:0.8, drop:0.20, hangover:25,
                            minLen:10, maxLen:140, hardStop:150,
                            refractory:50, startHold:2, warmup:20,
                            up:0.004, down:0.04 }, cfg||{});
  let floor=null, sd=0.2, n=0, on=false, startIdx=0, quiet=0, peak=-Infinity,
      len=0, mute=-1, hold=0, armed=true, told=false;
  const need = () => C.start;
  return {
    get floor(){ return floor; },
    get sd(){ return sd; },
    get need(){ return need(); },
    get speaking(){ return on; },
    reset(){ on=false; quiet=0; len=0; peak=-Infinity; mute=-1; hold=0; armed=true; told=false; },
    hush(frames, idx){ mute=Math.max(mute, idx+frames); on=false; quiet=0; len=0;
                       peak=-Infinity; hold=0; armed=false; told=false; },
    setCfg(c){ Object.assign(C, c); },
    // returnerer null, eller {from,to,why} der why er "ok" | "kort" | "lang"
    push(energy, idx){
      if(floor===null){ floor=energy; n=1; }
      if(!on){
        // Sperren stopper både deteksjon og gulvsporing: ser gulvet halen av
        // ordet, blir det dratt opp, og neste ord druknes.
        if(idx < mute){ hold=0; armed=false; return null; }
        n++;
        const warm = n<40;
        if(warm){ const a=1/n; floor=floor*(1-a)+energy*a; }   // rask innkjøring
        else floor += energy>floor ? C.up : -C.down;
        const over = energy-floor;
        // hvor høyt rommet vanligvis spretter over sitt eget gulv — bare til
        // visning og til forslaget «Mål rommet» gir
        const r = warm ? 1/n : 0.02;
        sd = sd*(1-r) + Math.max(0,over)*r;
        if(n < C.warmup) return null;      // hør på rommet før du dømmer
        const loud = over > need();
        // Etter en sperre må det bli stille FØR et nytt ord kan begynne.
        // Uten dette ble ordet du sa mens sperren gikk fanget fra midten av,
        // og en halv «trippel» ligner mest på et helt annet ord.
        if(!armed){
          if(!loud){ armed=true; told=false; return null; }
          if(told) return null;
          told=true;
          return { from:idx, to:idx, why:"sperret" };
        }
        if(loud){
          if(++hold < C.startHold) return null;
          on=true; startIdx=idx-(C.startHold-1); quiet=0; peak=energy; len=C.startHold;
        } else hold=0;
        return null;
      }
      len++;
      if(energy>peak) peak=energy;
      // slutt-terskelen følger ordets egen styrke, ikke en fast avstand
      const endLvl = floor + Math.max(C.endMin, (peak-floor)*C.drop);
      const below = energy < endLvl;
      quiet = below ? quiet+1 : 0;
      const done = quiet>=C.hangover, forced = len>=C.hardStop;
      if(!done && !forced) return null;
      const tail = done ? quiet : 0;
      // Sperren regnes fra der ordet faktisk sluttet, ikke fra nå. «Nå» er
      // allerede en pauselengde senere, og la vi sperren oppå det, ble
      // dødtiden pause + sperre — da forsvant ordet du sa rett etterpå.
      on=false; quiet=0; armed=false; told=false; mute = (idx-tail) + C.refractory;
      const from = startIdx-3, to = idx-tail+3;
      const seg = to-from;
      len=0; peak=-Infinity;
      if(seg < C.minLen) return { from, to, why:"kort" };
      if(seg > C.maxLen) return { from, to, why:"lang" };
      return { from, to, why:"ok" };
    }
  };
}

function loadCfg(){
  try{ return JSON.parse(localStorage.getItem(CFGKEY)) || {}; }catch(e){ return {}; }
}
const cfg = Object.assign({ thr:2.5, hangover:25, gap:50, ratio:0.85, drop:0.20 }, loadCfg());
function saveCfg(){
  try{ localStorage.setItem(CFGKEY, JSON.stringify(cfg)); }catch(e){}
}
function epCfg(){
  return { start:cfg.thr, endMin:Math.max(0.3,cfg.thr*0.35),
           hangover:cfg.hangover, refractory:cfg.gap, drop:cfg.drop };
}

function loadTemplates(){
  try{
    const raw=JSON.parse(localStorage.getItem(STORE));
    if(!raw) return {};
    const out={};
    for(const w in raw)
      out[w]=raw[w].map(t=>({ frames:t.map(fr=>({ mfcc:Float32Array.from(fr) })) }));
    return out;
  }catch(e){ return {}; }
}
function saveTemplates(templates){
  try{
    const out={};
    for(const w in templates)
      out[w]=templates[w].map(t=>t.frames.map(f=>Array.from(f.mfcc).map(v=>+v.toFixed(3))));
    localStorage.setItem(STORE, JSON.stringify(out));
    return true;
  }catch(e){ return false; }
}

/* ---- snuttene ----------------------------------------------------------
   Spektrogrammet må overleve at siden lukkes, ellers kan du ikke justere
   fasiten i morgen. Mel-verdiene ligger mellom -23 og +8, så én byte per
   verdi med 1/7 oppløsning er rikelig — det gir ~2,5 kB per snutt i stedet
   for ~12 kB som tekst. Selve lyden er for stor til å lagres; avspilling
   virker derfor bare i økten opptaket ble gjort.                          */
function packMel(mel){
  const n=mel.length, bands=mel[0].length, buf=new Uint8Array(n*bands);
  for(let i=0;i<n;i++) for(let b=0;b<bands;b++){
    const v=Math.round((mel[i][b]+25)*7);
    buf[i*bands+b] = v<0?0:(v>255?255:v);
  }
  let s="";
  for(let i=0;i<buf.length;i++) s+=String.fromCharCode(buf[i]);
  return btoa(s);
}
function unpackMel(str, bands){
  const bin=atob(str), n=Math.floor(bin.length/bands), out=[];
  for(let i=0;i<n;i++){
    const r=new Float32Array(bands);
    for(let b=0;b<bands;b++) r[b]=bin.charCodeAt(i*bands+b)/7-25;
    out.push(r);
  }
  return out;
}

function downsample(inp, ratio){
  const n=Math.floor(inp.length/ratio), out=new Float32Array(n);
  for(let i=0;i<n;i++){
    const p=i*ratio, a=Math.floor(p), f=p-a;
    out[i]= a+1<inp.length ? inp[a]*(1-f)+inp[a+1]*f : inp[a];
  }
  return out;
}

/* ---- mikrofonen ----
   Rå lyd. Automatisk volumkontroll skrur opp følsomheten når det blir
   stille, så romlyden ETTER et ord måles høyere enn romlyden FØR — og da
   faller nivået aldri tilbake dit det var. Støydemping og ekkokansellering
   pumper på samme måte. Alle tre jobber mot en energibasert orddeteksjon,
   så vi vil ha signalet urørt.                                            */
function makeMic(onFrame){
  let ctx=null, stream=null, node=null, on=false;
  let pending=new Float32Array(0);
  function feed(chunk){
    const merged=new Float32Array(pending.length+chunk.length);
    merged.set(pending); merged.set(chunk,pending.length);
    pending=merged;
    let off=0;
    while(pending.length-off >= P.frameLen){
      const f=frameFeature(pending,off);
      f.pcm=pending.slice(off, off+P.hop);   // lyden bak ramma, til avspilling
      onFrame(f);
      off += P.hop;
    }
    pending = pending.slice(off);
  }
  return {
    get on(){ return on; },
    get ctx(){ return ctx; },
    async start(){
      stream = await navigator.mediaDevices.getUserMedia({
        audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false }
      });
      const AC = window.AudioContext || window.webkitAudioContext;
      try{ ctx = new AC({ sampleRate:P.sampleRate }); }
      catch(e){ ctx = new AC(); }
      if(ctx.state==="suspended") await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      node = ctx.createScriptProcessor(2048,1,1);
      const ratio = ctx.sampleRate / P.sampleRate;
      node.onaudioprocess = ev => {
        const inp = ev.inputBuffer.getChannelData(0);
        feed(ratio>1.01 ? downsample(inp,ratio) : inp);
      };
      src.connect(node);
      // ScriptProcessor må ha en utgang for å kjøre, men skal ikke høres
      const dead = ctx.createGain(); dead.gain.value = 0;
      node.connect(dead); dead.connect(ctx.destination);
      on = true;
      return { rate:ctx.sampleRate, resampled:ratio>1.01 };
    },
    stop(){
      on=false;
      try{ if(node){ node.onaudioprocess=null; node.disconnect(); } }catch(e){}
      try{ if(stream) stream.getTracks().forEach(t=>t.stop()); }catch(e){}
      node=null; stream=null; pending=new Float32Array(0);
    }
  };
}

/* ---- hvilket ord ligner mest? ----
   «ratio» er beste avstand delt på nest beste. Et forholdstall i stedet for
   en absolutt grense, fordi avstandene skalerer med opptaket — en fast
   grense måtte vært stilt på nytt for hver stemme og hvert rom.
   «cutoff» lar DTW gi opp tidlig mot fasiter som uansett ikke kan vinne.   */
function classify(probe, templates){
  const scores={};
  let cutoff=null;
  for(const w in templates){
    if(!templates[w] || !templates[w].length) continue;
    let best=Infinity;
    templates[w].forEach(t=>{
      const d=dtw(probe,t.frames,null,cutoff);
      if(d<best) best=d;
      if(cutoff===null || d<cutoff) cutoff=d;
    });
    scores[w]=best;
  }
  const ranked=Object.keys(scores).sort((a,b)=>scores[a]-scores[b]);
  if(!ranked.length) return { word:null, ratio:1, sure:false, scores, ranked };
  const best=ranked[0];
  const ratio = ranked[1]!=null ? scores[best]/scores[ranked[1]] : 0;
  return { word:best, ratio, sure:ratio<=cfg.ratio, scores, ranked };
}

/* Hvor mange ord som faktisk er lest inn — appen bruker dette til å vite
   om stemmestyring i det hele tatt er mulig. */
function ready(){
  const t=loadTemplates();
  return WORDS.filter(w=>(t[w]||[]).length>0).length;
}

/* ---- skyverne ----
   Én definisjon, brukt både på innlesingssiden og i panelet under spill, så
   de to aldri kan vise forskjellige tall. Pause og sperre lagres i rammer
   (10 ms hver) fordi detektoren teller rammer, men vises i ms.            */
const CONTROLS = [
  { key:"thr", min:0.5, max:10, step:0.1,
    lab:"Terskel — hvor mye over romnivået et ord må være",
    vis:v=>v.toFixed(1).replace(".",","),
    note:"Den røde streken i måleren. Skal ligge godt over romstøyen, men under stemmen din." },
  { key:"hangover", min:10, max:60, step:1,
    lab:"Pause før ordet regnes som ferdig",
    vis:v=>(v*10)+" ms",
    note:"Blir ett ord til flere utslag, øk den. Smelter to ord sammen, senk den." },
  { key:"gap", min:10, max:100, step:1,
    lab:"Sperre mellom ord",
    vis:v=>(v*10)+" ms",
    note:"Dødtid etter hvert ord. Det er denne som avgjør hvor kjapt du kan si dem etter hverandre." },
  { key:"ratio", min:0.50, max:0.99, step:0.01,
    lab:"Hvor sikker den må være før den sier et ord",
    vis:v=>v.toFixed(2).replace(".",","),
    note:"Beste ord delt på nest beste. Lavere er strengere og gir flere spørsmålstegn. Høyere gjør at den heller gjetter." },
  { key:"drop", min:0.05, max:0.50, step:0.01,
    lab:"Hvor mye lyden må falle før ordet er slutt",
    vis:v=>v.toFixed(2).replace(".",","),
    note:"Andel av ordets egen styrke. Lavere drar med etterklang. Høyere kutter svake sluttlyder som f-en i «treff»." }
];
let stilLagt=false;
function leggStil(){
  if(stilLagt) return;
  stilLagt=true;
  const st=document.createElement("style");
  st.textContent=
    ".vc-row{margin-bottom:14px}"+
    ".vc-row:last-child{margin-bottom:0}"+
    ".vc-top{display:flex;align-items:baseline;gap:10px}"+
    ".vc-lab{flex:1;font-size:10.5px;font-weight:700;letter-spacing:.1em;"+
      "text-transform:uppercase;color:var(--ink2);line-height:1.35}"+
    ".vc-val{flex:none;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums}"+
    ".vc-row input[type=range]{display:block;width:100%;margin:4px 0 0;height:26px;accent-color:var(--red)}"+
    ".vc-note{font-size:11px;color:var(--ink2);line-height:1.45}";
  document.head.appendChild(st);
}
function controls(el, opts){
  opts=opts||{};
  leggStil();
  el.innerHTML="";
  const rader={};
  CONTROLS.forEach(c=>{
    const row=document.createElement("div"); row.className="vc-row";
    const top=document.createElement("div"); top.className="vc-top";
    const lab=document.createElement("span"); lab.className="vc-lab"; lab.textContent=c.lab;
    const val=document.createElement("b"); val.className="vc-val";
    top.appendChild(lab); top.appendChild(val);
    const inp=document.createElement("input");
    inp.type="range"; inp.min=c.min; inp.max=c.max; inp.step=c.step; inp.value=cfg[c.key];
    const note=document.createElement("div"); note.className="vc-note"; note.textContent=c.note;
    row.appendChild(top); row.appendChild(inp); row.appendChild(note);
    el.appendChild(row);
    const vis=()=>{ val.textContent=c.vis(cfg[c.key]); inp.value=cfg[c.key]; };
    vis();
    inp.addEventListener("input", ()=>{
      cfg[c.key]=+inp.value; vis(); saveCfg();
      if(opts.onChange) opts.onChange(c.key);
    });
    rader[c.key]={vis};
  });
  return { refresh(){ for(const k in rader) rader[k].vis(); } };
}

/* ============================================================
   FRASER — tre piler i ett jafs
   ============================================================
   Ett ord alene er kort, og «bom» er kortest av dem. Sier du hele runden
   i én slurk blir snutten tre ganger så lang, og da har DTW langt mer å
   kjenne igjen på — også overgangene mellom ordene, som forsvinner helt
   når hvert ord vurderes for seg.

   Alle kombinasjoner er 4 x 4 x 4 = 64. Det er for mange å lese inn. I
   stedet leses 12 fraser som dekker hvert ord minst to ganger i hver av
   de tre posisjonene, og de 64 settes sammen av de bitene. Er en frase
   faktisk lest inn, brukes det ekte opptaket framfor sammensetningen.  */
const PWORDS = ["treff","bom","dobbel","trippel"];
const PHRASES = [
  ["treff","treff","treff"],   ["bom","bom","bom"],
  ["dobbel","dobbel","dobbel"],["trippel","trippel","trippel"],
  ["treff","bom","dobbel"],    ["bom","dobbel","trippel"],
  ["dobbel","trippel","treff"],["trippel","treff","bom"],
  ["treff","dobbel","bom"],    ["bom","trippel","dobbel"],
  ["dobbel","bom","treff"],    ["trippel","dobbel","bom"]
];
const PKEY = "dart_voice_phrases";

/* Lagres uten normalisering: et sammensatt mønster må normaliseres under
   ett, ikke bit for bit, ellers passer ikke delene sammen.               */
function loadPhrases(){
  try{
    const raw=JSON.parse(localStorage.getItem(PKEY));
    if(!raw) return {};
    const out={};
    for(const k in raw)
      out[k]=raw[k].map(r=>({ f:r.f.map(v=>Float32Array.from(v)), b:r.b }));
    return out;
  }catch(e){ return {}; }
}
function savePhrases(ph){
  try{
    const out={};
    for(const k in ph)
      out[k]=ph[k].map(r=>({ f:r.f.map(m=>Array.from(m).map(v=>+v.toFixed(3))), b:r.b }));
    localStorage.setItem(PKEY, JSON.stringify(out));
    return true;
  }catch(e){ return false; }
}
// Hvor mange av de fire ordene finnes det biter av? Under fire kan ikke
// alle kombinasjonene settes sammen, og da har stemmestyring ingen mening.
function phraseReady(ph){
  const bank=wordBank(ph||loadPhrases());
  return PWORDS.filter(w=>bank[w] && (bank[w][0].length||bank[w][1].length||bank[w][2].length)).length;
}
function phraseCount(ph){
  let n=0; for(const k in ph) n+=ph[k].length; return n;
}

/* Hvert opptak gir tre ordbiter, og vi husker hvilken plass de sto på.
   «bom» sist i en runde uttales ikke helt likt «bom» først.             */
function wordBank(ph){
  const bank={};
  for(const key in ph){
    const words=key.split("|");
    ph[key].forEach(r=>{
      const cuts=[0].concat(r.b, [r.f.length]);
      words.forEach((w,i)=>{
        const seg=r.f.slice(cuts[i], cuts[i+1]);
        if(seg.length<5) return;
        if(!bank[w]) bank[w]=[[],[],[]];
        bank[w][i].push(seg);
      });
    });
  }
  return bank;
}
// Den som ligner mest på de andre er den tryggeste å bygge videre på.
function medoid(list){
  if(!list.length) return null;
  if(list.length<3) return list[0];
  let best=list[0], bestSum=Infinity;
  list.forEach(a=>{
    const A=cmn(a.map(m=>({mfcc:m})));
    let sum=0;
    list.forEach(b=>{ if(b!==a) sum+=dtw(A, cmn(b.map(m=>({mfcc:m}))), null, null); });
    if(sum<bestSum){ bestSum=sum; best=a; }
  });
  return best;
}
function buildCombos(ph, maxLen){
  maxLen = maxLen||3;
  const bank=wordBank(ph);
  const valgt={};                    // ord+plass -> beste bit
  PWORDS.forEach(w=>{
    for(let i=0;i<3;i++){
      const b=bank[w];
      let liste = b && b[i] && b[i].length ? b[i] : null;
      if(!liste && b) liste = b[0].concat(b[1], b[2]);
      valgt[w+i] = liste && liste.length ? medoid(liste) : null;
    }
  });
  const out=[];
  (function bygg(cur){
    if(cur.length){
      const key=cur.join("|");
      if(ph[key] && ph[key].length){
        ph[key].forEach(r=>out.push({ combo:cur.slice(),
          frames:cmn(r.f.map(m=>({mfcc:m}))), ekte:true }));
      } else {
        const flat=[];
        let helt=true;
        cur.forEach((w,i)=>{
          const seg=valgt[w+i];
          if(!seg){ helt=false; return; }
          seg.forEach(m=>flat.push({mfcc:m}));
        });
        if(helt && flat.length) out.push({ combo:cur.slice(), frames:cmn(flat), ekte:false });
      }
    }
    if(cur.length>=maxLen) return;
    PWORDS.forEach(w=>bygg(cur.concat([w])));
  })([]);
  return out;
}
/* Hele ytringen mot hvert kandidatmønster. Ingen tidlig avbrytelse her:
   vi trenger den nest beste for å vite hvor sikker den var.             */
function classifyPhrase(probe, combos){
  let best=null, bestD=Infinity, second=Infinity, secondC=null;
  for(let i=0;i<combos.length;i++){
    const d=dtw(probe, combos[i].frames, null, null);
    if(d<bestD){ second=bestD; secondC=best; bestD=d; best=combos[i]; }
    else if(d<second){ second=d; secondC=combos[i]; }
  }
  if(!best) return { combo:null, ratio:1, sure:false };
  const ratio = isFinite(second) && second>0 ? bestD/second : 0;
  return { combo:best.combo, ekte:best.ekte, dist:bestD, ratio,
           sure: ratio<=cfg.ratio, nest: secondC?secondC.combo:null };
}

window.Voice = {
  P, fft, dct, frameFeature, cmn, dist, dtw, makeEndpointer,
  packMel, unpackMel, classify, makeMic, ready, controls, CONTROLS,
  PWORDS, PHRASES, PKEY, loadPhrases, savePhrases, phraseCount,
  wordBank, buildCombos, classifyPhrase, phraseReady,
  cfg, saveCfg, epCfg, loadTemplates, saveTemplates,
  WORDS, TARGET, STORE, SNIPKEY, CFGKEY, MINSEG
};
})();
