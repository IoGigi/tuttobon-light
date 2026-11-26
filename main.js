import JsBarcode from 'jsbarcode';
import { analizzaBuono } from './src/estrattoreBuoni.js';

const STORAGE_KEY = 'wallet_buoni_v2';
let buoni = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let buonoAttivoId = null;
let wakeLock = null;

// Registrazione Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.error);
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHARED_FILE' && event.data.file) {
      gestisciFile(event.data.file);
    }
  });
}

// Elementi DOM
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const loader = document.getElementById('loader');
const buonoForm = document.getElementById('buonoForm');
const listaBuoniEl = document.getElementById('listaBuoni');
const totaleDisponibileEl = document.getElementById('totaleDisponibile');
const toggleEsauriti = document.getElementById('toggleEsauriti');

// Eventi Upload & Form
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) gestisciFile(e.target.files[0]);
});

document.getElementById('btnManuale').addEventListener('click', () => {
  buonoForm.reset();
  buonoForm.classList.add('active');
});

document.getElementById('btnAnnulla').addEventListener('click', () => {
  buonoForm.classList.remove('active');
});

async function gestisciFile(file) {
  loader.classList.add('active');
  buonoForm.classList.remove('active');
  try {
    const dati = await analizzaBuono(file);
    document.getElementById('inputNegozio').value = dati.negozio || '';
    document.getElementById('inputImporto').value = dati.importo || '';
    document.getElementById('inputCodice').value = dati.codiceBarre || '';
    document.getElementById('inputFormato').value = dati.formatoBarcode || 'CODE128';
    document.getElementById('inputScadenza').value = dati.scadenza || '';
    buonoForm.classList.add('active');
  } catch (err) {
    alert('Errore nella lettura del file. Puoi inserire i dati manualmente.');
    buonoForm.classList.add('active');
  } finally {
    loader.classList.remove('active');
    fileInput.value = '';
  }
}

buonoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const negozio = document.getElementById('inputNegozio').value.trim();
  const importo = parseFloat(document.getElementById('inputImporto').value);
  const codice = document.getElementById('inputCodice').value.trim();
  const formato = document.getElementById('inputFormato').value;
  const scadenza = document.getElementById('inputScadenza').value.trim();

  // Auto-apprendimento nuovo negozio per i prossimi import
  if (negozio) {
    const salvati = JSON.parse(localStorage.getItem('negozi_custom_v1') || '[]');
    if (!salvati.some(n => n.toLowerCase() === negozio.toLowerCase())) {
      salvati.push(negozio);
      localStorage.setItem('negozi_custom_v1', JSON.stringify(salvati));
    }
  }

  const nuovoBuono = {
    id: Date.now().toString(),
    negozio,
    importoIniziale: importo,
    residuo: importo,
    codice,
    formato,
    scadenza,
    movimenti: []
  };

  buoni.unshift(nuovoBuono);
  salvaStorage();
  buonoForm.reset();
  buonoForm.classList.remove('active');
  renderLista();
});

function salvaStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buoni));
}

function formatEuro(num) {
  return num.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function renderLista() {
  const mostraEsauriti = toggleEsauriti.checked;
  let totale = 0;
  listaBuoniEl.innerHTML = '';

  buoni.forEach(b => {
    if (b.residuo > 0) totale += b.residuo;
    if (b.residuo <= 0 && !mostraEsauriti) return;

    const card = document.createElement('div');
    card.className = 'buono-card' + (b.residuo <= 0 ? ' esaurito' : '');
    card.innerHTML = `
      <div class="buono-info">
        <h3>${b.negozio}</h3>
        <div class="buono-meta">
          ${b.scadenza ? 'Scad: ' + b.scadenza + ' • ' : ''}Cod: ...${b.codice.slice(-4)}
        </div>
      </div>
      <div class="buono-importo">
        <span class="residuo">${formatEuro(b.residuo)}</span>
        ${b.residuo < b.importoIniziale ? `<span class="iniziale">su ${formatEuro(b.importoIniziale)}</span>` : ''}
      </div>
    `;
    card.addEventListener('click', () => apriModalitaCassa(b.id));
    listaBuoniEl.appendChild(card);
  });

  totaleDisponibileEl.textContent = formatEuro(totale);
}

toggleEsauriti.addEventListener('change', renderLista);

// Modalità Cassa
const cassaModal = document.getElementById('cassaModal');

async function apriModalitaCassa(id) {
  const b = buoni.find(item => item.id === id);
  if (!b) return;
  buonoAttivoId = id;

  document.getElementById('cassaNegozio').textContent = b.negozio;
  document.getElementById('cassaScadenza').textContent = b.scadenza ? `Scadenza: ${b.scadenza}` : '';
  document.getElementById('cassaCodiceTesto').textContent = b.codice;
  document.getElementById('cassaResiduo').textContent = formatEuro(b.residuo);
  document.getElementById('inputSpesa').value = '';

  try {
    JsBarcode('#barcodeSvg', b.codice, {
      format: b.formato || 'CODE128',
      lineColor: '#000000',
      background: '#ffffff',
      width: 2.2,
      height: 95,
      displayValue: false
    });
  } catch (e) {
    JsBarcode('#barcodeSvg', b.codice, {
      format: 'CODE128',
      width: 2,
      height: 95,
      displayValue: false
    });
  }

  renderMovimenti(b);
  cassaModal.classList.add('active');

  // Mantiene lo schermo acceso in cassa
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {}
  }
}

function renderMovimenti(b) {
  const cont = document.getElementById('cassaMovimenti');
  if (!b.movimenti || b.movimenti.length === 0) {
    cont.innerHTML = '';
    return;
  }
  cont.innerHTML = '<h4>Storico utilizzi:</h4>' + b.movimenti.map(m => `
    <div class="movimento-item">
      <span>${m.data}</span>
      <strong>- ${formatEuro(m.importo)}</strong>
    </div>
  `).join('');
}

document.getElementById('btnChiudiCassa').addEventListener('click', () => {
  cassaModal.classList.remove('active');
  buonoAttivoId = null;
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
  renderLista();
});

document.getElementById('btnScala').addEventListener('click', () => {
  const val = parseFloat(document.getElementById('inputSpesa').value);
  if (isNaN(val) || val <= 0) return;
  scalaImporto(val);
});

document.getElementById('btnUsaTutto').addEventListener('click', () => {
  const b = buoni.find(item => item.id === buonoAttivoId);
  if (b && b.residuo > 0) scalaImporto(b.residuo);
});

function scalaImporto(spesa) {
  const b = buoni.find(item => item.id === buonoAttivoId);
  if (!b) return;
  const effettivo = Math.min(spesa, b.residuo);
  b.residuo = Math.round((b.residuo - effettivo) * 100) / 100;
  b.movimenti.unshift({
    data: new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    importo: effettivo
  });
  salvaStorage();
  document.getElementById('cassaResiduo').textContent = formatEuro(b.residuo);
  document.getElementById('inputSpesa').value = '';
  renderMovimenti(b);
}

document.getElementById('btnEliminaBuono').addEventListener('click', () => {
  if (!confirm('Eliminare definitivamente questo buono?')) return;
  buoni = buoni.filter(item => item.id !== buonoAttivoId);
  salvaStorage();
  document.getElementById('btnChiudiCassa').click();
});

// Backup & Ripristino JSON
document.getElementById('btnExport').addEventListener('click', () => {
  const dataStr = JSON.stringify({
    buoni,
    negoziCustom: JSON.parse(localStorage.getItem('negozi_custom_v1') || '[]')
  }, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-buoni-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const backupInput = document.getElementById('backupInput');
document.getElementById('btnImportBackup').addEventListener('click', () => backupInput.click());
backupInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (Array.isArray(parsed.buoni)) {
        buoni = parsed.buoni;
        salvaStorage();
        if (Array.isArray(parsed.negoziCustom)) {
          localStorage.setItem('negozi_custom_v1', JSON.stringify(parsed.negoziCustom));
        }
        renderLista();
        alert('Backup ripristinato con successo!');
      }
    } catch (err) {
      alert('File di backup non valido.');
    }
  };
  reader.readAsText(file);
  backupInput.value = '';
});

renderLista();
