import {
  auth, db, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updatePassword,
  doc, setDoc, getDoc, updateDoc, addDoc, getDocs, collection, query, where, serverTimestamp, orderBy
} from './firebase.js';

// ---- Helpers ----
const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => (Number(v || 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayISO = () => new Date().toISOString().slice(0,10);
const adminsMat = new Set(['4144','70029','6266']);
const emailFromMat = (mat) => `${mat}@movebuss.com`;

// State
let currentUserDoc = null; // Firestore user doc data
let currentCaixaRef = null; // { userId, caixaId }

// Elements
const authArea = $('#authArea');
const appArea = $('#appArea');
const userBadge = $('#userBadge');
const btnLogin = $('#btnLogin');
const btnRegistrar = $('#btnRegistrar');
const btnLogout = $('#btnLogout');
const btnChangePass = $('#btnChangePass');
const btnAbrir = $('#btnAbrir');
const btnFechar = $('#btnFechar');
const caixaStatusEl = $('#caixaStatus');

// Forms
const loginMatricula = $('#loginMatricula');
const loginSenha = $('#loginSenha');
const cadNome = $('#cadNome');
const cadMatricula = $('#cadMatricula');
const cadSenha = $('#cadSenha');

const lancBox = $('#lancamentoBox');
const sangriaBox = $('#sangriaBox');
const relatorioLista = $('#relatorioLista');
const matRecebedor = $('#matRecebedor');

const qtdBordos = $('#qtdBordos');
const valor = $('#valor');
const tipoVal = $('#tipoVal');
const prefixo = $('#prefixo');
const dataCaixa = $('#dataCaixa');
const matMotorista = $('#matMotorista');

// Update valor automatico = qtd * 5
const updateValor = () => {
  const q = Number(qtdBordos.value || 0);
  valor.value = (q * 5).toFixed(2);
};
qtdBordos.addEventListener('input', updateValor);

// Prefixo: only digits and max 3
prefixo.addEventListener('input', () => {
  prefixo.value = prefixo.value.replace(/\D/g, '').slice(0,3);
});

// Date default
dataCaixa.value = todayISO();

// ---- Auth flows ----
btnRegistrar.addEventListener('click', async () => {
  const nome = cadNome.value.trim();
  const mat = cadMatricula.value.trim();
  const senha = cadSenha.value;
  if (!nome || !mat || !senha) return alert('Preencha nome, matrícula e senha.');

  try {
    const cred = await createUserWithEmailAndPassword(auth, emailFromMat(mat), senha);
    const isAdmin = adminsMat.has(mat);
    await setDoc(doc(db, 'users', cred.user.uid), {
      nome, matricula: mat, admin: isAdmin, createdAt: serverTimestamp()
    });
    alert('Conta criada! Faça login com sua matrícula e senha.');
    // Redirect visual
    cadNome.value = cadMatricula.value = cadSenha.value = '';
    loginMatricula.value = mat;
    loginSenha.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    console.error(e);
    alert('Erro ao criar conta: ' + (e?.message || e));
  }
});

btnLogin.addEventListener('click', async () => {
  const mat = loginMatricula.value.trim();
  const senha = loginSenha.value;
  if (!mat || !senha) return alert('Informe matrícula e senha.');
  try {
    await signInWithEmailAndPassword(auth, emailFromMat(mat), senha);
  } catch (e) {
    console.error(e);
    alert('Falha no login: ' + (e?.message || e));
  }
});

btnLogout.addEventListener('click', async () => {
  await signOut(auth);
});

btnChangePass.addEventListener('click', async () => {
  const nova = prompt('Digite a nova senha:');
  if (!nova) return;
  try {
    await updatePassword(auth.currentUser, nova);
    alert('Senha alterada com sucesso.');
  } catch (e) {
    alert('Erro ao alterar senha: ' + (e?.message || e));
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    authArea.classList.remove('hidden');
    appArea.classList.add('hidden');
    userBadge.classList.add('hidden');
    btnLogout.classList.add('hidden');
    btnChangePass.classList.add('hidden');
    currentUserDoc = null;
    currentCaixaRef = null;
    return;
  }
  // Load user doc
  const uref = doc(db, 'users', user.uid);
  const snap = await getDoc(uref);
  currentUserDoc = snap.data();
  // Ensure admin if matricula on list
  if (adminsMat.has(currentUserDoc?.matricula) && !currentUserDoc.admin) {
    await updateDoc(uref, { admin: true });
    currentUserDoc.admin = true;
  }

  // UI
  authArea.classList.add('hidden');
  appArea.classList.remove('hidden');
  btnLogout.classList.remove('hidden');
  btnChangePass.classList.remove('hidden');
  matRecebedor.value = currentUserDoc.matricula;

  // Badge
  userBadge.textContent = `${currentUserDoc.nome} • ${currentUserDoc.matricula}`;
  userBadge.classList.remove('hidden');
  if (currentUserDoc.admin) userBadge.classList.add('admin'); else userBadge.classList.remove('admin');

  // Carregar / detectar caixa aberto
  await detectOrUpdateCaixaStatus();
});

async function detectOrUpdateCaixaStatus() {
  const uid = auth.currentUser.uid;
  // query caixas abertos do proprio usuario
  const q1 = query(collection(db, 'users', uid, 'caixas'), where('status', '==', 'aberto'));
  const abertos = await getDocs(q1);
  if (!abertos.empty) {
    const docRef = abertos.docs[0].ref;
    currentCaixaRef = { userId: uid, caixaId: docRef.id };
    setStatusUI('aberto');
    enableWorkflows(true);
    await renderParcial();
  } else {
    currentCaixaRef = null;
    setStatusUI('fechado');
    enableWorkflows(false);
    relatorioLista.textContent = 'Sem lançamentos. Abra um caixa para iniciar.';
  }
}

function setStatusUI(status) {
  caixaStatusEl.textContent = status === 'aberto' ? 'Caixa Aberto' : 'Caixa Fechado';
}

function enableWorkflows(aberto) {
  btnAbrir.disabled = !!aberto;
  btnFechar.disabled = !aberto;
  lancBox.classList.toggle('hidden', !aberto);
  sangriaBox.classList.toggle('hidden', !aberto);
}

// ---- Caixa controls ----
btnAbrir.addEventListener('click', async () => {
  const uid = auth.currentUser.uid;
  // Impedir 2 abertos para mesma matrícula
  const q1 = query(collection(db, 'users', uid, 'caixas'), where('status', '==', 'aberto'));
  const openDocs = await getDocs(q1);
  if (!openDocs.empty) return alert('Você já possui um caixa aberto.');

  const caixa = {
    status: 'aberto',
    createdAt: serverTimestamp(),
    data: todayISO(),
    matricula: currentUserDoc.matricula,
    nome: currentUserDoc.nome
  };
  const ref = await addDoc(collection(db, 'users', uid, 'caixas'), caixa);
  currentCaixaRef = { userId: uid, caixaId: ref.id };
  setStatusUI('aberto');
  enableWorkflows(true);
  await renderParcial();
  alert('Caixa aberto com sucesso.');
});

btnFechar.addEventListener('click', async () => {
  if (!currentCaixaRef) return;
  await gerarRelatorioPDF(); // gera e baixa A4
  // Marcar fechado
  const ref = doc(db, 'users', currentCaixaRef.userId, 'caixas', currentCaixaRef.caixaId);
  await updateDoc(ref, { status: 'fechado', closedAt: serverTimestamp() });
  currentCaixaRef = null;
  setStatusUI('fechado');
  enableWorkflows(false);
  relatorioLista.textContent = 'Caixa encerrado. Abra um novo quando necessário.';
});

// ---- Lançamentos e Recibos ----
$('#btnSalvarLanc').addEventListener('click', async () => {
  if (!currentCaixaRef) return alert('Abra um caixa primeiro.');
  const dados = {
    tipoValidador: tipoVal.value,
    qtdBordos: Number(qtdBordos.value || 0),
    valor: Number(valor.value || 0),
    prefixo: '55' + (prefixo.value || '000'),
    dataCaixa: dataCaixa.value,
    matriculaMotorista: (matMotorista.value || '').trim(),
    matriculaRecebedor: currentUserDoc.matricula,
    createdAt: serverTimestamp()
  };
  if (!dados.qtdBordos || !dados.matriculaMotorista) return alert('Informe a quantidade e a matrícula do motorista.');

  const ref = collection(db, 'users', currentCaixaRef.userId, 'caixas', currentCaixaRef.caixaId, 'lancamentos');
  await addDoc(ref, dados);

  // Atualiza UI
  await renderParcial();

  // Imprime recibo térmico automaticamente
  printThermalReceipt(dados);
});

$('#btnRegistrarSangria').addEventListener('click', async () => {
  if (!currentCaixaRef) return alert('Abra um caixa primeiro.');
  const valor = Number($('#sangriaValor').value || 0);
  const motivo = ($('#sangriaMotivo').value || '').trim();
  if (valor <= 0 || !motivo) return alert('Informe valor e motivo da sangria.');
  const ref = collection(db, 'users', currentCaixaRef.userId, 'caixas', currentCaixaRef.caixaId, 'sangrias');
  await addDoc(ref, { valor, motivo, createdAt: serverTimestamp() });
  $('#sangriaValor').value = ''; $('#sangriaMotivo').value='';
  await renderParcial();
  alert('Sangria registrada.');
});

async function renderParcial() {
  // Lista simples de lançamentos + sangrias
  const base = `Usuário: ${currentUserDoc.nome} • Matrícula: ${currentUserDoc.matricula}\n`;
  const lref = collection(db, 'users', currentCaixaRef.userId, 'caixas', currentCaixaRef.caixaId, 'lancamentos');
  const sref = collection(db, 'users', currentCaixaRef.userId, 'caixas', currentCaixaRef.caixaId, 'sangrias');
  const lqs = await getDocs(query(lref, orderBy('createdAt','asc')));
  const sqs = await getDocs(query(sref, orderBy('createdAt','asc')));
  let total = 0;
  let out = base + '\nLANÇAMENTOS:\n';
  lqs.forEach(d => {
    const x = d.data();
    total += Number(x.valor||0);
    out += `• ${x.dataCaixa} ${x.prefixo} ${x.tipoValidador} Qtd:${x.qtdBordos} Valor:${fmtMoney(x.valor)} Mot:${x.matriculaMotorista}\n`;
  });
  let totalS = 0;
  if (!sqs.empty) {
    out += '\nSANGRIAS:\n';
    sqs.forEach(d => {
      const x = d.data();
      totalS += Number(x.valor||0);
      out += `• ${fmtMoney(x.valor)} — ${x.motivo}\n`;
    });
  }
  out += `\nTOTAL LANÇAMENTOS: ${fmtMoney(total)}\n`;
  out += `TOTAL SANGRIAS: ${fmtMoney(totalS)}\n`;
  out += `TOTAL CORRIGIDO: ${fmtMoney(total - totalS)}\n`;
  relatorioLista.textContent = out;
}

function printThermalReceipt(data) {
  // Janela de impressão térmica
  const win = window.open('', '_blank', 'width=400,height=800');
  const dt = new Date().toLocaleString('pt-BR');

  const html = `<!DOCTYPE html>
  <html><head><meta charset="utf-8">
  <title>Recibo</title>
  <style>
    /* TAMANHO TÉRMICO: mais compacto */
    @page { size: 80mm 120mm; margin: 4mm; }

    /* Fonte mais grossa em todo o recibo */
    body {
      font-family: "Arial Black", Arial, Helvetica, sans-serif;
      font-size: 12px;
      font-weight: 800;
      margin: 0;
    }

    /* Título centralizado */
    h1 {
      text-align: center;
      font-size: 16px;
      margin: 2px 0 6px;
      font-weight: 900;
    }

    /* Truque para "puxar da direita para o centro":
       bloco mais estreito, colado na direita, e o conteúdo alinhado à direita */
    .receipt {
      width: 58mm;        /* menor que 80mm -> conteúdo sai mais para o centro */
      margin-left: auto;  /* ancora o bloco na borda direita */
      text-align: right;  /* alinha internamente todas as linhas à direita */
    }

    /* Barras verdes (efeito metálico simples) */
    .bar {
      height: 2px;
      background: linear-gradient(90deg, #2a6b2a, #4fd34f, #2a6b2a);
      margin: 6px 0;
    }

    .row { margin: 2px 0; }
    .label { font-weight: 900; }

    .sig {
      margin-top: 14px;
      padding-top: 6px;
      border-top: 1px solid #000;
      text-align: center;
      font-weight: 700;
    }
  </style></head>
  <body onload="window.print(); setTimeout(()=>window.close(), 500);">
    <h1>RECIBO DE PAGAMENTO MANUAL</h1>
    <div class="receipt">
      <div class="bar"></div>
      <div class="row"><span class="label">Tipo de validador:</span> ${data.tipoValidador}</div>
      <div class="row"><span class="label">PREFIXO:</span> ${data.prefixo}</div>
      <div class="row"><span class="label">QUANTIDADE BORDOS:</span> ${data.qtdBordos}</div>
      <div class="row"><span class="label">VALOR:</span> R$ ${Number(data.valor).toFixed(2)}</div>
      <div class="row"><span class="label">MATRICULA MOTORISTA:</span> ${data.matriculaMotorista}</div>
      <div class="row"><span class="label">MATRICULA RECEBEDOR:</span> ${data.matriculaRecebedor}</div>
      <div class="row"><span class="label">DATA RECEBIMENTO:</span> ${dt}</div>
      <div class="bar"></div>
      <div class="sig">ASSINATURA RECEBEDOR</div>
    </div>
  </body></html>`;

  win.document.write(html);
  win.document.close();
}


async function gerarRelatorioPDF() {
  const { jsPDF } = window.jspdf;
  const docpdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = docpdf.internal.pageSize.getWidth();

  // Busca dados do caixa (ajuste os gets conforme seu código/variáveis)
  // currentUserDoc: { nome, matricula }
  // currentCaixaRef: { userId, caixaId }
  const uid = currentCaixaRef.userId;
  const cid = currentCaixaRef.caixaId;

  // Caixa (datas/horas)
  const cref = doc(db, 'users', uid, 'caixas', cid);
  const caixaSnap = await getDoc(cref);
  const cx = caixaSnap.data() || {};
  const createdAt = cx.createdAt?.toDate ? cx.createdAt.toDate() : new Date();
  const closedAt  = cx.closedAt?.toDate ? cx.closedAt.toDate() : new Date();

  // Utilitário: carrega imagem como DataURL
  async function loadImageAsDataURL(path) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = path;
    });
  }

  // Logo (coloque em ./assets/logo.png)
  const logoDataUrl = await loadImageAsDataURL('./assets/logo.png').catch(() => null);

  // ===== Cabeçalho =====
  let y = 40;
  if (logoDataUrl) {
    const lw = 140, lh = 65;
    const lx = (pageWidth - lw) / 2;
    docpdf.addImage(logoDataUrl, 'PNG', lx, y, lw, lh);
    y += lh + 6;
  }

  docpdf.setFont('helvetica', 'bold'); 
  docpdf.setFontSize(18);
  docpdf.text('RELATÓRIO DE FECHAMENTO DE CAIXA', pageWidth / 2, y, { align: 'center' });
  y += 12;

  const drawGreenBar = (yy) => {
    docpdf.setFillColor(46, 139, 87); // verde
    docpdf.rect(40, yy, pageWidth - 80, 4, 'F');
  };
  y += 8; drawGreenBar(y); y += 16;

  // Bloco de informações (centralizado visualmente, 2 colunas)
  docpdf.setFont('helvetica', 'normal'); 
  docpdf.setFontSize(12);

  const left = [
    `Matrícula Recebedor: ${currentUserDoc.matricula}`,
    `Data Abertura: ${createdAt.toLocaleDateString('pt-BR')}`,
    `Data Fechamento: ${closedAt.toLocaleDateString('pt-BR')}`
  ];
  const right = [
    `Nome: ${currentUserDoc.nome}`,
    `Hora Abertura: ${createdAt.toLocaleTimeString('pt-BR')}`,
    `Hora Fechamento: ${closedAt.toLocaleTimeString('pt-BR')}`
  ];

  let ix = 60, iy = y;
  left.forEach((t, i) => docpdf.text(t, ix, iy + i * 16));
  const rx = pageWidth / 2 + 20;
  right.forEach((t, i) => docpdf.text(t, rx, iy + i * 16));

  y = iy + left.length * 16 + 18;
  docpdf.setFont('helvetica', 'bold');
  docpdf.text(`Status: ${(cx.status || '').toUpperCase()}   •   Caixa Nº: ${cid}`, pageWidth / 2, y, { align: 'center' });

  y += 10; drawGreenBar(y); y += 16;

  // ===== Lançamentos =====
  docpdf.setFont('helvetica', 'bold'); docpdf.setFontSize(14);
  docpdf.text('Lançamentos', 40, y); y += 14;
  docpdf.setFont('helvetica', 'normal'); docpdf.setFontSize(11);

  const lref = collection(db, 'users', uid, 'caixas', cid, 'lancamentos');
  const lqs = await getDocs(query(lref, orderBy('createdAt', 'asc')));

  const cols = ['Horário','Validador','Prefixo','Bordos','Valor (R$)','Matr. Motorista'];
  const colX = [40, 120, 220, 300, 380, 470];

  docpdf.setFont('helvetica', 'bold');
  cols.forEach((c, i) => docpdf.text(c, colX[i], y));
  y += 10; drawGreenBar(y); y += 10;
  docpdf.setFont('helvetica', 'normal');

  let total = 0;
  lqs.forEach(d => {
    const x = d.data();
    const quando = x.createdAt?.toDate ? x.createdAt.toDate() : new Date();
    const row = [
      quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      x.tipoValidador, x.prefixo, String(x.qtdBordos),
      Number(x.valor).toFixed(2), x.matriculaMotorista
    ];
    if (y > 760) { docpdf.addPage(); y = 40; }
    row.forEach((txt, i) => docpdf.text(String(txt), colX[i], y));
    y += 14;
    total += Number(x.valor || 0);
  });

  // ===== Sangrias =====
  y += 6; drawGreenBar(y); y += 16;
  docpdf.setFont('helvetica', 'bold'); docpdf.setFontSize(14);
  docpdf.text('Sangrias', 40, y); y += 14;
  docpdf.setFont('helvetica', 'normal'); docpdf.setFontSize(11);

  const sref = collection(db, 'users', uid, 'caixas', cid, 'sangrias');
  const sqs = await getDocs(query(sref, orderBy('createdAt', 'asc')));
  let totalS = 0;

  if (sqs.empty) {
    docpdf.text('— Nenhuma', 40, y); y += 14;
  } else {
    const scol = ['Horário','Valor (R$)','Motivo'];
    const scx  = [40, 120, 200];
    docpdf.setFont('helvetica', 'bold'); scol.forEach((c,i)=>docpdf.text(c, scx[i], y));
    y += 10; drawGreenBar(y); y += 10; docpdf.setFont('helvetica', 'normal');

    sqs.forEach(d => {
      const x = d.data();
      const quando = x.createdAt?.toDate ? x.createdAt.toDate() : new Date();
      const line = [
        quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        Number(x.valor).toFixed(2),
        x.motivo
      ];
      if (y > 760) { docpdf.addPage(); y = 40; }
      line.forEach((t,i)=>docpdf.text(String(t), scx[i], y));
      y += 14;
      totalS += Number(x.valor || 0);
    });
  }

  // ===== Resumo =====
  y += 8; drawGreenBar(y); y += 16;
  docpdf.setFont('helvetica', 'bold'); docpdf.setFontSize(14);
  docpdf.text('Resumo Financeiro', 40, y); y += 16;

  docpdf.setFont('helvetica', 'normal'); docpdf.setFontSize(12);
  docpdf.text(`Total Abastecido: ${(Number(total)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 40, y); y += 16;
  docpdf.text(`Total Sangrias: ${(Number(totalS)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 40, y); y += 16;

  docpdf.setFont('helvetica', 'bold');
  docpdf.text(`Saldo Final: ${(Number(total - totalS)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 40, y); 
  y += 24;

  // ===== Assinatura =====
  drawGreenBar(y); y += 24;
  docpdf.setFont('helvetica', 'normal');
  docpdf.text('Assinatura do Recebedor', pageWidth / 2, y + 28, { align: 'center' });
  docpdf.line(pageWidth / 2 - 160, y + 20, pageWidth / 2 + 160, y + 20);

  const fileName = `${currentUserDoc.matricula}-${new Date().toISOString().slice(0,10)}.pdf`;
  docpdf.save(fileName);
}async function gerarRelatorioPDF() {
  const { jsPDF } = window.jspdf;
  const docpdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = docpdf.internal.pageSize.getWidth();

  // Busca dados do caixa (ajuste os gets conforme seu código/variáveis)
  // currentUserDoc: { nome, matricula }
  // currentCaixaRef: { userId, caixaId }
  const uid = currentCaixaRef.userId;
  const cid = currentCaixaRef.caixaId;

  // Caixa (datas/horas)
  const cref = doc(db, 'users', uid, 'caixas', cid);
  const caixaSnap = await getDoc(cref);
  const cx = caixaSnap.data() || {};
  const createdAt = cx.createdAt?.toDate ? cx.createdAt.toDate() : new Date();
  const closedAt  = cx.closedAt?.toDate ? cx.closedAt.toDate() : new Date();

  // Utilitário: carrega imagem como DataURL
  async function loadImageAsDataURL(path) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = path;
    });
  }

  // Logo (coloque em ./assets/logo.png)
  const logoDataUrl = await loadImageAsDataURL('./assets/logo.png').catch(() => null);

  // ===== Cabeçalho =====
  let y = 40;
  if (logoDataUrl) {
    const lw = 140, lh = 65;
    const lx = (pageWidth - lw) / 2;
    docpdf.addImage(logoDataUrl, 'PNG', lx, y, lw, lh);
    y += lh + 6;
  }

  docpdf.setFont('helvetica', 'bold'); 
  docpdf.setFontSize(18);
  docpdf.text('RELATÓRIO DE FECHAMENTO DE CAIXA', pageWidth / 2, y, { align: 'center' });
  y += 12;

  const drawGreenBar = (yy) => {
    docpdf.setFillColor(46, 139, 87); // verde
    docpdf.rect(40, yy, pageWidth - 80, 4, 'F');
  };
  y += 8; drawGreenBar(y); y += 16;

  // Bloco de informações (centralizado visualmente, 2 colunas)
  docpdf.setFont('helvetica', 'normal'); 
  docpdf.setFontSize(12);

  const left = [
    `Matrícula Recebedor: ${currentUserDoc.matricula}`,
    `Data Abertura: ${createdAt.toLocaleDateString('pt-BR')}`,
    `Data Fechamento: ${closedAt.toLocaleDateString('pt-BR')}`
  ];
  const right = [
    `Nome: ${currentUserDoc.nome}`,
    `Hora Abertura: ${createdAt.toLocaleTimeString('pt-BR')}`,
    `Hora Fechamento: ${closedAt.toLocaleTimeString('pt-BR')}`
  ];

  let ix = 60, iy = y;
  left.forEach((t, i) => docpdf.text(t, ix, iy + i * 16));
  const rx = pageWidth / 2 + 20;
  right.forEach((t, i) => docpdf.text(t, rx, iy + i * 16));

  y = iy + left.length * 16 + 18;
  docpdf.setFont('helvetica', 'bold');
  docpdf.text(`Status: ${(cx.status || '').toUpperCase()}   •   Caixa Nº: ${cid}`, pageWidth / 2, y, { align: 'center' });

  y += 10; drawGreenBar(y); y += 16;

  // ===== Lançamentos =====
  docpdf.setFont('helvetica', 'bold'); docpdf.setFontSize(14);
  docpdf.text('Lançamentos', 40, y); y += 14;
  docpdf.setFont('helvetica', 'normal'); docpdf.setFontSize(11);

  const lref = collection(db, 'users', uid, 'caixas', cid, 'lancamentos');
  const lqs = await getDocs(query(lref, orderBy('createdAt', 'asc')));

  const cols = ['Horário','Validador','Prefixo','Bordos','Valor (R$)','Matr. Motorista'];
  const colX = [40, 120, 220, 300, 380, 470];

  docpdf.setFont('helvetica', 'bold');
  cols.forEach((c, i) => docpdf.text(c, colX[i], y));
  y += 10; drawGreenBar(y); y += 10;
  docpdf.setFont('helvetica', 'normal');

  let total = 0;
  lqs.forEach(d => {
    const x = d.data();
    const quando = x.createdAt?.toDate ? x.createdAt.toDate() : new Date();
    const row = [
      quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      x.tipoValidador, x.prefixo, String(x.qtdBordos),
      Number(x.valor).toFixed(2), x.matriculaMotorista
    ];
    if (y > 760) { docpdf.addPage(); y = 40; }
    row.forEach((txt, i) => docpdf.text(String(txt), colX[i], y));
    y += 14;
    total += Number(x.valor || 0);
  });

  // ===== Sangrias =====
  y += 6; drawGreenBar(y); y += 16;
  docpdf.setFont('helvetica', 'bold'); docpdf.setFontSize(14);
  docpdf.text('Sangrias', 40, y); y += 14;
  docpdf.setFont('helvetica', 'normal'); docpdf.setFontSize(11);

  const sref = collection(db, 'users', uid, 'caixas', cid, 'sangrias');
  const sqs = await getDocs(query(sref, orderBy('createdAt', 'asc')));
  let totalS = 0;

  if (sqs.empty) {
    docpdf.text('— Nenhuma', 40, y); y += 14;
  } else {
    const scol = ['Horário','Valor (R$)','Motivo'];
    const scx  = [40, 120, 200];
    docpdf.setFont('helvetica', 'bold'); scol.forEach((c,i)=>docpdf.text(c, scx[i], y));
    y += 10; drawGreenBar(y); y += 10; docpdf.setFont('helvetica', 'normal');

    sqs.forEach(d => {
      const x = d.data();
      const quando = x.createdAt?.toDate ? x.createdAt.toDate() : new Date();
      const line = [
        quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        Number(x.valor).toFixed(2),
        x.motivo
      ];
      if (y > 760) { docpdf.addPage(); y = 40; }
      line.forEach((t,i)=>docpdf.text(String(t), scx[i], y));
      y += 14;
      totalS += Number(x.valor || 0);
    });
  }

  // ===== Resumo =====
  y += 8; drawGreenBar(y); y += 16;
  docpdf.setFont('helvetica', 'bold'); docpdf.setFontSize(14);
  docpdf.text('Resumo Financeiro', 40, y); y += 16;

  docpdf.setFont('helvetica', 'normal'); docpdf.setFontSize(12);
  docpdf.text(`Total Abastecido: ${(Number(total)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 40, y); y += 16;
  docpdf.text(`Total Sangrias: ${(Number(totalS)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 40, y); y += 16;

  docpdf.setFont('helvetica', 'bold');
  docpdf.text(`Saldo Final: ${(Number(total - totalS)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 40, y); 
  y += 24;

  // ===== Assinatura =====
  drawGreenBar(y); y += 24;
  docpdf.setFont('helvetica', 'normal');
  docpdf.text('Assinatura do Recebedor', pageWidth / 2, y + 28, { align: 'center' });
  docpdf.line(pageWidth / 2 - 160, y + 20, pageWidth / 2 + 160, y + 20);

  const fileName = `${currentUserDoc.matricula}-${new Date().toISOString().slice(0,10)}.pdf`;
  docpdf.save(fileName);
}