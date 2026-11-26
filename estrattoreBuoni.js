import { BrowserMultiFormatReader } from '@zxing/browser';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export async function analizzaBuono(file) {
  let immagineUrl = '';
  let testoEstratto = '';

  if (file.type === 'application/pdf') {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);

    const textContent = await page.getTextContent();
    testoEstratto = textContent.items.map(item => item.str).join(' ');

    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport }).promise;
    immagineUrl = canvas.toDataURL('image/png');
  } else {
    immagineUrl = URL.createObjectURL(file);
  }

  let codiceBarre = '';
  let formatoBarcode = 'CODE128';
  try {
    const codeReader = new BrowserMultiFormatReader();
    const result = await codeReader.decodeFromImageUrl(immagineUrl);
    codiceBarre = result.getText();
    const rawFormat = result.getBarcodeFormat().toString();
    if (rawFormat.includes('EAN_13') || rawFormat === '7') formatoBarcode = 'EAN13';
    else if (rawFormat.includes('EAN_8') || rawFormat === '6') formatoBarcode = 'EAN8';
    else if (rawFormat.includes('UPC_A') || rawFormat === '14') formatoBarcode = 'UPC';
    else formatoBarcode = 'CODE128';
  } catch (err) {
    console.warn('Nessun barcode rilevato automaticamente:', err);
  }

  if (!testoEstratto) {
    const worker = await createWorker('ita');
    const ret = await worker.recognize(immagineUrl);
    testoEstratto = ret.data.text;
    await worker.terminate();
  }

  if (file.type !== 'application/pdf') {
    URL.revokeObjectURL(immagineUrl);
  }

  const dati = estraiCampiDaTesto(testoEstratto);

  return {
    negozio: dati.negozio,
    importo: dati.importo,
    codiceBarre: codiceBarre,
    formatoBarcode: formatoBarcode,
    scadenza: dati.scadenza
  };
}

function estraiCampiDaTesto(testo) {
  const testoPulito = testo.replace(/\s+/g, ' ');

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
    { alias: ['bricoman', 'tecnoamat', 'tecnomat'], nome: 'Tecnomat' },
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

  const negoziCustom = JSON.parse(localStorage.getItem('negozi_custom_v1') || '[]');
  negoziCustom.forEach(nomeCustom => {
    mappaNegozi.unshift({ alias: [nomeCustom.toLowerCase()], nome: nomeCustom });
  });

  let negozioTrovato = '';
  const testoMinuscolo = testoPulito.toLowerCase();

  for (const voce of mappaNegozi) {
    const trovato = voce.alias.some(parolaChiave => {
      const escaped = parolaChiave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      return regex.test(testoMinuscolo);
    });
    if (trovato) {
      negozioTrovato = voce.nome;
      break;
    }
  }

  let importoTrovato = null;
  const regexImporto = /(?:€|EUR)\s*(\d+[.,]\d{2}|\d+)|(\d+[.,]\d{2}|\d+)\s*(?:€|EUR)/gi;
  const matchImporti = [...testoPulito.matchAll(regexImporto)];

  if (matchImporti.length > 0) {
    const primo = matchImporti[0];
    const rawNumero = primo[1] || primo[2];
    if (rawNumero) {
      importoTrovato = parseFloat(rawNumero.replace(',', '.'));
    }
  }

  let scadenzaTrovata = '';
  const regexData = /\b(0?[1-9]|[12][0-9]|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](202[5-9]|203\d)\b/g;
  const matchDate = [...testoPulito.matchAll(regexData)];

  if (matchDate.length > 0) {
    const tutteLeDate = matchDate.map(m => m[0].replace(/-/g, '/'));
    scadenzaTrovata = tutteLeDate[tutteLeDate.length - 1];
  }

  return {
    negozio: negozioTrovato,
    importo: importoTrovato,
    scadenza: scadenzaTrovata
  };
}
