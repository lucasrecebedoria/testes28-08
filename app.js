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
  // Open new window w/ thermal CSS and auto-print
  const win = window.open('', '_blank', 'width=400,height=800');
  const now = new Date();
  const dt = now.toLocaleString('pt-BR');
  const html = `<!DOCTYPE html>
  <html><head><meta charset="utf-8">
  <title>Recibo</title>
  <style>
    @page { size: 80mm 150mm; margin: 6mm; }
    body { font-family: "Courier New", Courier, monospace; font-size: 15px; }
    h1 { text-align: center; font-size: 16px; margin: 8px 0 12px; }
    .line { display:flex; justify-content: space-between; margin: 4px 0; }
    .mono { font-family: inherit; white-space: pre-wrap; }
    .center { text-align: center; }
    .sig { margin-top: 20px; border-top: 1px solid #000; width: 100%; }
  </style></head>
  <body onload="window.print(); setTimeout(()=>window.close(), 500);">
    <h1>RECIBO DE PAGAMENTO MANUAL</h1>
    <div class="mono">
      Tipo de validador: ${data.tipoValidador}\n
      PREFIXO: ${data.prefixo}\n
      QUANTIDADE BORDOS: ${data.qtdBordos}\n
      VALOR: R$ ${Number(data.valor).toFixed(2)}\n
      MATRICULA MOTORISTA: ${data.matriculaMotorista}\n
      MATRICULA RECEBEDOR: ${data.matriculaRecebedor}\n
      DATA RECEBIMENTO: ${dt}\n
      ASSINATURA RECEBEDOR:\n
      _____________________________
    </div>
  </body></html>`;
  win.document.write(html);
  win.document.close();
}

async function gerarRelatorioPDF() {
  const { jsPDF } = window.jspdf;
  const docpdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const uid = currentCaixaRef.userId;
  const cid = currentCaixaRef.caixaId;

  const lref = collection(db, 'users', uid, 'caixas', cid, 'lancamentos');
  const sref = collection(db, 'users', uid, 'caixas', cid, 'sangrias');
  const lqs = await getDocs(query(lref, orderBy('createdAt','asc')));
  const sqs = await getDocs(query(sref, orderBy('createdAt','asc')));

  let y = 40;
  docpdf.setFont('helvetica','bold'); docpdf.setFontSize(16);
  docpdf.text('Relatório de Fechamento de Caixa', 40, y); y += 22;
  docpdf.setFontSize(11); docpdf.setFont('helvetica','normal');
  const hoje = new Date();
  docpdf.text(`Operador: ${currentUserDoc.nome}  • Matrícula: ${currentUserDoc.matricula}`, 40, y); y+=16;
  docpdf.text(`Data: ${hoje.toLocaleDateString('pt-BR')} ${hoje.toLocaleTimeString('pt-BR')}`, 40, y); y+=22;
  docpdf.text('Detalhamento dos lançamentos:', 40, y); y+=16;

  let total = 0;
  lqs.forEach(d => {
    const x = d.data();
    const line = `${x.dataCaixa} | ${x.prefixo} | ${x.tipoValidador} | Qtd:${x.qtdBordos} | Valor: ${fmtMoney(x.valor)} | Mot:${x.matriculaMotorista}`;
    if (y > 760) { docpdf.addPage(); y = 40; }
    docpdf.text(line, 40, y); y+=14;
    total += Number(x.valor||0);
  });

  y += 14;
  docpdf.text('Sangrias registradas:', 40, y); y+=16;
  let totalS = 0;
  if (sqs.empty) { docpdf.text('— Nenhuma', 40, y); y+=14; }
  else {
    sqs.forEach(d => {
      const x = d.data();
      const line = `${fmtMoney(x.valor)} — Motivo: ${x.motivo}`;
      if (y > 760) { docpdf.addPage(); y = 40; }
      docpdf.text(line, 40, y); y+=14;
      totalS += Number(x.valor||0);
    });
  }

  y += 14;
  docpdf.setFont('helvetica','bold');
  docpdf.text(`TOTAL LANÇAMENTOS: ${fmtMoney(total)}`, 40, y); y+=16;
  docpdf.text(`TOTAL SANGRIAS: ${fmtMoney(totalS)}`, 40, y); y+=16;
  docpdf.text(`TOTAL CORRIGIDO: ${fmtMoney(total - totalS)}`, 40, y); y+=22;
  docpdf.setFont('helvetica','normal');
  docpdf.text('Fechamento resumido configurado para A4. Documento gerado automaticamente.', 40, y);

  const fileName = `${currentUserDoc.matricula}-${todayISO()}.pdf`;
  docpdf.save(fileName);
}
