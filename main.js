import JsBarcode from 'jsbarcode';
import { analizzaBuono } from './src/estrattoreBuoni.js';
import { getAllBuoni, saveBuono, deleteBuono, clearAndImportAll } from './src/db.js';

let buoniCache = [];
let buonoCorrenteId = null;
let immagineEmergenzaTemp = null;
let wakeLock = null;

const el = (id) => document.getElementById(id);

function showStatus(msg, type = 'info') {
  const box = el('statusMsg');
  box.textContent = msg;
  box.className = 'status-msg status-' + type;
  box.style.display = 'block';
}

function hideStatus() {
  el('statusMsg').style.display = 'none';
}

function formatEuro(num) {
  return Number(num || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

async function gestisciFileCaricato(file) {
  if (!file) return;
  el('formCard').style.display = 'none';
  showStatus('⏳ Analisi del file in corso...', 'info');

  try {
    const res = await analizzaBuono(file, (step) => {
      showStatus('⏳ ' + step, 'info');
    });

    immagineEmergenzaTemp = res.immagineEmergenza || null;
    el('inputNegozio').value = res.negozio || '';
    el('inputImporto').value = res.importo !== null ? res.importo : '';
    el('inputCodice').value = res.codiceBarre || '';
    el('inputFormato').value = res.formatoBarcode || 'CODE128';
    el('inputScadenza').value = res.scadenza || '';
    el('diagnosticaText').textContent = res.diagnostica || '';

    el('formCard').style.display = 'block';
    if (!res.codiceBarre) {
      showStatus('⚠️ Documento letto, ma inserisci o controlla il codice a barre qui sotto.', 'info');
    } else {
      showStatus('✅ Dati estratti con successo! Controlla e salva.', 'ok');
    }
  } catch (err) {
    console.error(err);
    immagineEmergenzaTemp = null;
    el('formCard').style.display = 'block';
    showStatus('❌ Errore lettura automatica: ' + err.message + '. Puoi comunque inserire i dati a mano qui sotto.', 'err');
  }
}

async function aggiornaLista() {
  buoniCache = await getAllBuoni();
  const mostraEsauriti = el('chkEsauriti').checked;
  const container = el('listaBuoni');
  container.innerHTML = '';

  let totale = 0;
  buoniCache.forEach((b) => {
    if (b.residuo > 0) totale += Number(b.residuo);
  });
  el('totaleDisponibile').textContent = formatEuro(totale);

  const filtrati = buoniCache.filter((b) => mostraEsauriti || b.residuo > 0.009);

  if (filtrati.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#64748b; margin-top:30px;">Nessun buono disponibile. Carica un PDF o uno screenshot qui sopra.</p>';
    return;
  }

  filtrati.forEach((b) => {
    const div = document.createElement('div');
    div.className = 'buono-item' + (b.residuo <= 0.009 ? ' esaurito' : '');
    div.innerHTML = `
      <div>
        <div class="buono-negozio">${escapeHtml(b.negozio)}</div>
        <div class="buono-meta">${b.scadenza ? 'Scad: ' + escapeHtml(b.scadenza) : 'Nessuna scadenza'} • ${escapeHtml(b.codiceBarre)}</div>
      </div>
      <div>
        <div class="buono-importo">${formatEuro(b.residuo)}</div>
        ${b.residuo < b.importoIniziale ? `<div class="buono-iniziale">su ${formatEuro(b.importoIniziale)}</div>` : ''}
      </div>
    `;
    div.addEventListener('click', () => apriModalCassa(b.id));
    container.appendChild(div);
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

async function apriModalCassa(id) {
  const buono = buoniCache.find((b) => b.id === id);
  if (!buono) return;
  buonoCorrenteId = id;

  el('cassaNegozio').textContent = buono.negozio;
  el('cassaScadenza').textContent = buono.scadenza ? 'Scadenza: ' + buono.scadenza : '';
  el('cassaCodiceTesto').textContent = buono.codiceBarre;
  el('cassaResiduo').textContent = formatEuro(buono.residuo);
  el('inputSpesaParziale').value = '';

  // Render barcode vettoriale
  const svg = el('barcodeSvg');
  svg.innerHTML = '';
  try {
    JsBarcode(svg, buono.codiceBarre, {
      format: buono.formatoBarcode || 'CODE128',
      width: 2.2,
      height: 95,
      displayValue: false,
      margin: 10
    });
  } catch (e) {
    try {
      JsBarcode(svg, buono.codiceBarre, {
        format: 'CODE128',
        width: 2,
        height: 95,
        displayValue: false
      });
    } catch (e2) {
      svg.innerHTML = '';
    }
  }

  // Documento originale
  if (buono.immagineEmergenza) {
    el('imgOriginale').src = buono.immagineEmergenza;
    el('tabOriginale').style.display = 'block';
  } else {
    el('imgOriginale').removeAttribute('src');
    el('tabOriginale').style.display = 'none';
  }

  attivaTab('barcode');
  renderMovimenti(buono);
  el('modalCassa').classList.add('open');

  // Mantieni schermo acceso in cassa
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {}
}

function attivaTab(quale) {
  if (quale === 'barcode') {
    el('tabBarcode').classList.add('active');
    el('tabOriginale').classList.remove('active');
    el('boxBarcode').style.display = 'block';
    el('boxOriginale').style.display = 'none';
  } else {
    el('tabOriginale').classList.add('active');
    el('tabBarcode').classList.remove('active');
    el('boxBarcode').style.display = 'none';
    el('boxOriginale').style.display = 'block';
  }
}

function renderMovimenti(buono) {
  const ul = el('listaMovimenti');
  ul.innerHTML = '';
  const movs = buono.movimenti || [];
  if (movs.length === 0) {
    ul.innerHTML = '<li>Nessun utilizzo registrato</li>';
    return;
  }
  movs.forEach((m) => {
    const li = document.createElement('li');
    li.textContent = `${m.data}: -${formatEuro(m.speso)} (Residuo: ${formatEuro(m.residuoDopo)})`;
    ul.appendChild(li);
  });
}

// Event Listeners
el('dropZone').addEventListener('click', () => el('fileInput').click());
el('fileInput').addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    gestisciFileCaricato(e.target.files[0]);
    e.target.value = '';
  }
});

el('btnManuale').addEventListener('click', () => {
  immagineEmergenzaTemp = null;
  el('inputNegozio').value = '';
  el('inputImporto').value = '';
  el('inputCodice').value = '';
  el('inputFormato').value = 'CODE128';
  el('inputScadenza').value = '';
  el('diagnosticaText').textContent = 'Inserimento manuale';
  el('formCard').style.display = 'block';
  hideStatus();
});

el('btnAnnullaForm').addEventListener('click', () => {
  el('formCard').style.display = 'none';
  hideStatus();
});

el('btnSalvaBuono').addEventListener('click', async () => {
  const negozio = el('inputNegozio').value.trim();
  const importo = parseFloat(el('inputImporto').value);
  const codiceBarre = el('inputCodice').value.trim();
  const formatoBarcode = el('inputFormato').value;
  const scadenza = el('inputScadenza').value.trim();

  if (!negozio || isNaN(importo) || importo <= 0 || !codiceBarre) {
    showStatus('⚠️ Compila Negozio, Importo e Codice a barre prima di salvare.', 'err');
    return;
  }

  // Salva negozio in auto-apprendimento
  try {
    const salvati = JSON.parse(localStorage.getItem('negozi_custom_v1') || '[]');
    if (!salvati.some((n) => n.toLowerCase() === negozio.toLowerCase())) {
      salvati.push(negozio);
      localStorage.setItem('negozi_custom_v1', JSON.stringify(salvati));
    }
  } catch (e) {}

  const nuovoBuono = {
    id: 'buono_' + Date.now(),
    negozio,
    importoIniziale: importo,
    residuo: importo,
    codiceBarre,
    formatoBarcode,
    scadenza,
    immagineEmergenza: immagineEmergenzaTemp,
    movimenti: [],
    createdAt: Date.now()
  };

  await saveBuono(nuovoBuono);
  el('formCard').style.display = 'none';
  immagineEmergenzaTemp = null;
  showStatus('✅ Buono salvato!', 'ok');
  setTimeout(hideStatus, 2500);
  await aggiornaLista();
});

el('chkEsauriti').addEventListener('change', aggiornaLista);
el('tabBarcode').addEventListener('click', () => attivaTab('barcode'));
el('tabOriginale').addEventListener('click', () => attivaTab('originale'));

el('btnChiudiModal').addEventListener('click', () => {
  el('modalCassa').classList.remove('open');
  buonoCorrenteId = null;
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
});

async function applicaSpesa(importoSpeso) {
  const buono = buoniCache.find((b) => b.id === buonoCorrenteId);
  if (!buono) return;
  if (isNaN(importoSpeso) || importoSpeso <= 0) return;

  const spesoReale = Math.min(buono.residuo, importoSpeso);
  buono.residuo = Math.max(0, Math.round((buono.residuo - spesoReale) * 100) / 100);
  buono.movimenti = buono.movimenti || [];
  buono.movimenti.unshift({
    data: new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    speso: spesoReale,
    residuoDopo: buono.residuo
  });

  await saveBuono(buono);
  el('cassaResiduo').textContent = formatEuro(buono.residuo);
  el('inputSpesaParziale').value = '';
  renderMovimenti(buono);
  await aggiornaLista();
}

el('btnScalaImporto').addEventListener('click', () => {
  const val = parseFloat(el('inputSpesaParziale').value);
  applicaSpesa(val);
});

el('btnUsaTutto').addEventListener('click', () => {
  const buono = buoniCache.find((b) => b.id === buonoCorrenteId);
  if (buono && buono.residuo > 0) {
    applicaSpesa(buono.residuo);
  }
});

el('btnEliminaBuono').addEventListener('click', async () => {
  if (!buonoCorrenteId) return;
  if (confirm('Vuoi eliminare definitivamente questo buono?')) {
    await deleteBuono(buonoCorrenteId);
    el('btnChiudiModal').click();
    await aggiornaLista();
  }
});

// Backup & Ripristino
el('btnBackup').addEventListener('click', async () => {
  const tutti = await getAllBuoni();
  const payload = {
    versione: '2.2',
    dataExport: new Date().toISOString(),
    negoziCustom: JSON.parse(localStorage.getItem('negozi_custom_v1') || '[]'),
    buoni: tutti
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-buoni-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

el('btnRipristina').addEventListener('click', () => el('inputRipristina').click());
el('inputRipristina').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (Array.isArray(data.buoni)) {
      await clearAndImportAll(data.buoni);
      if (Array.isArray(data.negoziCustom)) {
        localStorage.setItem('negozi_custom_v1', JSON.stringify(data.negoziCustom));
      }
      await aggiornaLista();
      showStatus('✅ Backup ripristinato con successo!', 'ok');
      setTimeout(hideStatus, 2500);
    } else {
      throw new Error('Formato file non valido');
    }
  } catch (err) {
    showStatus('❌ Errore ripristino backup: ' + err.message, 'err');
  }
  e.target.value = '';
});

// Service Worker & Web Share Target
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHARED_FILE' && event.data.file) {
      gestisciFileCaricato(event.data.file);
    }
  });
}

aggiornaLista();
