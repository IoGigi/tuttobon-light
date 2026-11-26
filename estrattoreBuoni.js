import { BrowserMultiFormatReader } from '@zxing/browser';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function ridimensionaImmagine(dataUrl, maxWidth = 1400, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Errore lettura file dal dispositivo'));
    reader.readAsDataURL(file);
  });
}

export async function analizzaBuono(file, onProgress = () => {}) {
  let immagineUrl = '';
  let testoEstratto = '';
  const log = [];

  try {
    // 1. GESTIONE PDF vs IMMAGINE
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      onProgress('Lettura PDF in corso...');
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);

      const textContent = await page.getTextContent();
      testoEstratto = textContent.items.map((item) => item.str).join(' ');
      log.push('PDF testo estratto (' + testoEstratto.length + ' caratteri)');

      const viewport = page.getViewport({ scale: 2.2 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: context, viewport }).promise;
      immagineUrl = canvas.toDataURL('image/jpeg', 0.9);
    } else {
      onProgress('Caricamento immagine...');
      const rawDataUrl = await fileToDataUrl(file);
      immagineUrl = await ridimensionaImmagine(rawDataUrl, 1600, 0.9);
      log.push('Immagine preparata');
    }

    // 2. LETTURA BARCODE CON ZXING
    onProgress('Scansione codice a barre...');
    let codiceBarre = '';
    let formatoBarcode = 'CODE128';

    try {
      const codeReader = new BrowserMultiFormatReader();
      const imgElement = new Image();
      imgElement.src = immagineUrl;
      await new Promise((res, rej) => {
        imgElement.onload = res;
        imgElement.onerror = rej;
      });
      const result = await codeReader.decodeFromImageElement(imgElement);
      codiceBarre = result.getText();
      const rawFormat = result.getBarcodeFormat().toString();
      if (rawFormat.includes('EAN_13') || rawFormat === '7') formatoBarcode = 'EAN13';
      else if (rawFormat.includes('EAN_8') || rawFormat === '6') formatoBarcode = 'EAN8';
      else if (rawFormat.includes('QR') || rawFormat === '11') formatoBarcode = 'QRCODE';
      else formatoBarcode = 'CODE128';
      log.push('Barcode rilevato: ' + codiceBarre);
    } catch (barcodeErr) {
      log.push('Barcode non rilevato automaticamente (inseribile a mano)');
    }

    // 3. LETTURA TESTO CON TESSERACT SE NON È UN PDF CON TESTO
    if (!testoEstratto || testoEstratto.trim().length < 10) {
      onProgress('Lettura testo (OCR)...');
      try {
        const worker = await createWorker('ita');
        const ret = await worker.recognize(immagineUrl);
        testoEstratto = ret.data.text || '';
        await worker.terminate();
        log.push('OCR completato (' + testoEstratto.length + ' caratteri)');
      } catch (ocrErr) {
        log.push('Avviso OCR: ' + (ocrErr.message || 'non disponibile offline'));
      }
    }

    // 4. PARSING CAMPI
    onProgress('Estrazione dati...');
    const dati = estraiCampiDaTesto(testoEstratto);

    // Salva copia compressa per emergenza cassa
    const immagineEmergenza = await ridimensionaImmagine(immagineUrl, 1100, 0.75);

    return {
      negozio: dati.negozio,
      importo: dati.importo,
      codiceBarre: codiceBarre,
      formatoBarcode: formatoBarcode,
      scadenza: dati.scadenza,
      immagineEmergenza: immagineEmergenza,
      diagnostica: log.join(' • ')
    };
  } catch (err) {
    throw new Error((err && err.message ? err.message : String(err)) + ' [' + log.join(' | ') + ']');
  }
}

function estraiCampiDaTesto(testo) {
  const testoPulito = (testo || '').replace(/\s+/g, ' ');

  const mappaNegozi = [
    { alias: ['martinelli', 'supermercati martinelli'], nome: 'Martinelli' },
    { alias: ['rossetto', 'supermercati rossetto'], nome: 'Rossetto' },
    { alias: ['migross', 'mig for you'], nome: 'Migross / Martinelli / Rossetto' },
    { alias: ['esselunga'], nome: 'Esselunga' },
    { alias: ['bennet'], nome: 'Bennet' },
    { alias: ['famila', 'galassia', 'unicomm', 'emisfero'], nome: 'Famila / Galassia' },
    { alias: ['despar', 'eurospar', 'interspar', 'aspiag'], nome: 'Despar' },
    { alias: ['conad', 'spazio conad', 'conad superstore'], nome: 'Conad' },
    { alias: ['coop', 'ipercoop', 'coop alleanza'], nome: 'Coop' },
    { alias: ['carrefour', 'carrefour market', 'carrefour express'], nome: 'Carrefour' },
    { alias: ['lidl'], nome: 'Lidl' },
    { alias: ['aldi'], nome: 'Aldi' },
    { alias: ['eurospin'], nome: 'Eurospin' },
    { alias: ['md spa', 'md discount'], nome: 'MD' },
    { alias: ['pam', 'panorama', 'pam local'], nome: 'Pam Panorama' },
    { alias: ['iper', 'la grande i', 'unes', 'u2 supermercato'], nome: 'Iper / Unes' },
    { alias: ['tigros'], nome: 'Tigros' },
    { alias: ['iperal'], nome: 'Iperal' },
    { alias: ['poli', 'supermercati poli'], nome: 'Poli' },
    { alias: ['crai'], nome: 'Crai' },
    { alias: ['naturasi', 'natura sì'], nome: 'NaturaSì' },
    { alias: ['q8', 'kuwait', 'recarga q8'], nome: 'Q8' },
    { alias: ['eni', 'enilive', 'agip'], nome: 'Eni' },
    { alias: ['ip', 'gruppo api'], nome: 'IP' },
    { alias: ['tamoil'], nome: 'Tamoil' },
    { alias: ['ikea'], nome: 'Ikea' },
    { alias: ['leroy merlin'], nome: 'Leroy Merlin' },
    { alias: ['tecnomat', 'bricoman'], nome: 'Tecnomat' },
    { alias: ['decathlon'], nome: 'Decathlon' },
    { alias: ['mediaworld'], nome: 'MediaWorld' },
    { alias: ['unieuro'], nome: 'Unieuro' },
    { alias: ['amazon'], nome: 'Amazon' },
    { alias: ['zalando'], nome: 'Zalando' },
    { alias: ['ovs', 'upim'], nome: 'OVS' },
    { alias: ['coin'], nome: 'Coin' },
    { alias: ['feltrinelli', 'lafeltrinelli'], nome: 'LaFeltrinelli' },
    { alias: ['mondadori'], nome: 'Mondadori' },
    { alias: ['tigota', 'tigotà'], nome: 'Tigotà' },
    { alias: ['acqua & sapone', 'acqua e sapone'], nome: 'Acqua & Sapone' },
    { alias: ['kasanova'], nome: 'Kasanova' },
    { alias: ['thefork', 'the fork'], nome: 'TheFork' },
    { alias: ['deliveroo'], nome: 'Deliveroo' },
    { alias: ['glovo'], nome: 'Glovo' },
    { alias: ['just eat', 'justeat'], nome: 'Just Eat' },
    { alias: ['trenitalia'], nome: 'Trenitalia' },
    { alias: ['italo'], nome: 'Italo' }
  ];

  try {
    const negoziCustom = JSON.parse(localStorage.getItem('negozi_custom_v1') || '[]');
    negoziCustom.forEach((nomeCustom) => {
      if (nomeCustom) {
        mappaNegozi.unshift({ alias: [nomeCustom.toLowerCase()], nome: nomeCustom });
      }
    });
  } catch (e) {}

  let negozioTrovato = '';
  const testoMinuscolo = testoPulito.toLowerCase();

  for (const voce of mappaNegozi) {
    const trovato = voce.alias.some((parolaChiave) => {
      const escaped = parolaChiave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('\\b' + escaped + '\\b', 'i');
      return regex.test(testoMinuscolo);
    });
    if (trovato) {
      negozioTrovato = voce.nome;
      break;
    }
  }

  // Estrazione Importo (fix su gruppi di cattura match[1] / match[2])
  let importoTrovato = null;
  const regexImporto = /(?:€|EUR)\s*(\d+[.,]\d{2}|\d+)|(\d+[.,]\d{2}|\d+)\s*(?:€|EUR)/gi;
  const matchImporti = [...testoPulito.matchAll(regexImporto)];
  if (matchImporti.length > 0) {
    for (const m of matchImporti) {
      const rawNumero = m[1] || m[2];
      if (rawNumero) {
        const val = parseFloat(rawNumero.replace(',', '.'));
        if (!isNaN(val) && val > 0 && val <= 5000) {
          importoTrovato = val;
          break;
        }
      }
    }
  }

  // Estrazione Data di scadenza (fix su match[0])
  let scadenzaTrovata = '';
  const regexData = /\b(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](202[5-9]|203\d)\b/g;
  const matchDate = [...testoPulito.matchAll(regexData)];
  if (matchDate.length > 0) {
    const tutteLeDate = matchDate.map((m) => m[0].replace(/-/g, '/'));
    scadenzaTrovata = tutteLeDate[tutteLeDate.length - 1];
  }

  return {
    negozio: negozioTrovato,
    importo: importoTrovato,
    scadenza: scadenzaTrovata
  };
}
