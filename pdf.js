/* ============================================================
   pdf.js — Geração de PDFs (Sistema de Estoque)
   ------------------------------------------------------------
   Extraído de work.html/index.html em 29/07 como primeiro passo
   real da desmembração do arquivo único. Carregado via <script
   src="pdf.js"> comum (NÃO type="module") — continua
   compartilhando o mesmo escopo global do resto do app, então
   todas as funções e variáveis do arquivo principal (catalog,
   unitStock, envios, minimums, session, getUnitCatalog(),
   getMinPerDay(), classificarItem(), nextEnviarDay(), el(),
   toast(), etc.) continuam acessíveis normalmente daqui, e as
   funções deste arquivo continuam acessíveis normalmente do
   arquivo principal (ex: onclick="printStockPdf(...)" no HTML).
   Nenhum comportamento foi alterado nesta extração — é só um
   recorte de texto, função por função, para o arquivo principal
   ficar menor e essa parte do sistema ficar isolada em um lugar
   só.

   Funções deste arquivo:
   - pdfStr(str): encoder de texto para o formato PDF (Latin-1/WinAnsi)
   - openPdfCategoriesModal(...): modal de seleção de categorias antes de gerar o PDF de contagem
   - _baixarPdfString(...): dispara o download do PDF já montado
   - printStockPdf(...): PDF de Contagem de Estoque (CPD e unidades)
   - gerarPdfEnvios(...): PDF de Lista de Produção / Lista de Compras
   - gerarPdfEnviosTabela(...): PDF em formato de tabela dos Envios do Dia
   - qpGerarPDF(...): PDF do Quadro de Produção
   ============================================================ */

function pdfStr(str) {
  let out = '';
  for (const ch of String(str)) {
    const code = ch.charCodeAt(0);
    if (ch === '(') out += '\\(';
    else if (ch === ')') out += '\\)';
    else if (ch === '\\') out += '\\\\';
    else if (code < 128) out += ch;
    else if (code <= 0xFF) out += '\\' + code.toString(8).padStart(3, '0');
    else {
      const norm = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      out += (norm && norm.charCodeAt(0) < 128) ? norm : '?';
    }
  }
  return '(' + out + ')';
}
function openPdfCategoriesModal(pdfLabel, stockObj, categories) {
  const overlay = el('div', {cls:'confirm-modal-overlay'});
  const box = el('div', {cls:'confirm-modal-box'});

  const hdr = el('div', {cls:'confirm-modal-hdr'});
  hdr.appendChild(el('div', {cls:'confirm-modal-title'}, 'Gerar PDF de Contagem'));
  hdr.appendChild(el('div', {cls:'confirm-modal-sub'}, 'Selecione as categorias que devem entrar no PDF.'));
  box.appendChild(hdr);

  const body = el('div', {cls:'confirm-modal-body'});
  const selectRow = el('div', {style:'display:flex;gap:8px;margin-bottom:10px'});
  const selAllBtn  = el('button', {cls:'btn btn-outline btn-sm', style:'font-size:11px;padding:4px 10px'}, 'Selecionar todas');
  const selNoneBtn = el('button', {cls:'btn btn-outline btn-sm', style:'font-size:11px;padding:4px 10px'}, 'Nenhuma');
  selectRow.appendChild(selAllBtn);
  selectRow.appendChild(selNoneBtn);
  body.appendChild(selectRow);

  const listWrap = el('div', {style:'display:flex;flex-direction:column;gap:8px'});
  const checks = [];
  (categories || []).forEach(cat => {
    const label = el('label', {style:'display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer'});
    const cb = el('input', {type:'checkbox'});
    cb.checked = true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(cat));
    listWrap.appendChild(label);
    checks.push({ cat, cb });
  });
  body.appendChild(listWrap);
  box.appendChild(body);

  selAllBtn.addEventListener('click', () => checks.forEach(c => { c.cb.checked = true; }));
  selNoneBtn.addEventListener('click', () => checks.forEach(c => { c.cb.checked = false; }));

  const ftr = el('div', {cls:'confirm-modal-ftr'});
  const cancelBtn = el('button', {cls:'btn btn-outline btn-sm'}, 'Cancelar');
  cancelBtn.addEventListener('click', () => overlay.remove());
  const okBtn = el('button', {cls:'btn btn-sm', style:'background:var(--accent,#1A5229);color:#fff'}, 'Gerar PDF');
  okBtn.addEventListener('click', () => {
    const selected = checks.filter(c => c.cb.checked).map(c => c.cat);
    if (selected.length === 0) { toast('Selecione ao menos uma categoria.'); return; }
    overlay.remove();
    printStockPdf(pdfLabel, stockObj, selected);
  });
  ftr.appendChild(cancelBtn);
  ftr.appendChild(okBtn);
  box.appendChild(ftr);

  overlay.appendChild(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
function _baixarPdfString(pdfBinaryStr, fname) {
  let base64;
  try {
    base64 = btoa(pdfBinaryStr);
  } catch (e) {
    // Caractere fora do intervalo 0-255 escapou de algum ponto do gerador —
    // não deveria acontecer, mas evita quebrar o download por causa disso.
    console.warn('[PDF] Caractere inválido no conteúdo, substituindo por "?":', e);
    base64 = btoa(pdfBinaryStr.replace(/[^\x00-\xFF]/g, '?'));
  }
  const dataUri = 'data:application/pdf;base64,' + base64;

  // Safari no iPhone/iPad não respeita o atributo "download" de um <a>, e
  // testamos que abrir o data: URI direto numa aba nova (window.open) também
  // não funciona de forma confiável — fica tela preta. O jeito mais robusto
  // conhecido pro Safari é montar um Blob real (não base64 puro) e abrir a
  // URL de objeto gerada a partir dele — funciona melhor com arquivos
  // maiores e é o padrão mais usado pra isso no Safari.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS se identifica como Mac
  if (isIOS) {
    try {
      const bytes = new Uint8Array(pdfBinaryStr.length);
      for (let i = 0; i < pdfBinaryStr.length; i++) bytes[i] = pdfBinaryStr.charCodeAt(i) & 0xFF;
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, '_blank');
      if (!win) {
        if (typeof toast === 'function') toast('Permita pop-ups para ver o PDF, ou tente novamente.');
        window.location.href = blobUrl;
      }
      // Não revoga o blobUrl logo em seguida de propósito — a aba nova
      // ainda precisa carregar o conteúdo; o navegador libera a memória
      // sozinho quando a aba/documento que a usa é fechado.
    } catch (e) {
      console.warn('[PDF] Falha ao gerar Blob no iOS, tentando data URI como último recurso:', e);
      const win = window.open(dataUri, '_blank');
      if (!win) window.location.href = dataUri;
    }
    return;
  }

  const a = document.createElement('a');
  a.href = dataUri;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function printStockPdf(unitLabel, stockObj, onlyCategory) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR', {day:'2-digit', month:'long', year:'numeric'});
  const timeStr = now.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
  const user = session?.name || '';

  // Sempre buscar o estoque mais atual de unitStock[] na hora de gerar, em vez
  // de confiar só no `stockObj` recebido por parâmetro. Motivo: os botões de
  // PDF capturam `ustock` no momento do render(); se os dados do Firebase
  // ainda não tinham chegado nesse momento, esse objeto fica "congelado"
  // vazio — e como updates seguintes só repintam a tabela na tela
  // (patchStockValues), sem recriar o botão, o PDF podia sair zerado mesmo
  // com a tela mostrando os números certos. Buscando de novo aqui garante
  // que o PDF sempre reflete o estado mais recente em memória.
  if (unitLabel !== 'CPD' && typeof unitStock !== 'undefined' && unitStock[unitLabel]) {
    stockObj = unitStock[unitLabel];
  }

  // Group items by category — TODOS os itens, inclusive zerados e sem mínimo
  // PDF: usar catálogo específico da unidade
  const _unitInfo  = (unitLabel !== 'CPD') ? getUnitCatalog(unitLabel) : null;
  const pdfCatSrc  = (unitLabel === 'CPD') ? catalog   : _unitInfo.catalog;
  const pdfCats    = (unitLabel === 'CPD') ? CATEGORIES : _unitInfo.categories;
  // onlyCategory pode ser uma string (uma categoria) ou um array (várias
  // categorias selecionadas no modal de seleção) — normaliza para array.
  const _catFilter = onlyCategory
    ? (Array.isArray(onlyCategory) ? onlyCategory : [onlyCategory])
    : null;
  const byCategory = {};
  pdfCats.forEach(cat => { byCategory[cat] = []; });
  pdfCatSrc.forEach(item => {
    if (_catFilter && !_catFilter.includes(item.category)) return;
    const qty = stockObj[item.id] || 0;
    const min = minimums[item.id] || 0;
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push({name: item.name, key: item.key, unit: item.unit, qty, min});
  });
  // Remove categorias sem nenhum item cadastrado (ou fora do filtro)
  pdfCats.forEach(cat => { if (byCategory[cat].length === 0) delete byCategory[cat]; });

  // Build PDF rows
  const W = 595, ML = 40, MR = 40, TW = W - ML - MR;
  const showMinCol = unitLabel === 'CPD';

  // Coluna "A Enviar": calcular para unidades a partir do plano de envios.
  // Usa a mesma função canônica nextEnviarDay() usada em todo o resto do
  // app (Envios do Dia, gerarPdfEnvios, etc.) — antes esse cálculo do
  // "próximo dia de entrega" era refeito aqui na mão, sem o horário de
  // corte (HORA_CORTE_ENVIO_DIA), então esse PDF podia divergir da tela
  // e dos outros PDFs logo depois do corte do dia. Unificado em 29/07.
  const _enviarDay = nextEnviarDay();
  // Construir mapa nome_normalizado → quantidade a enviar para esta unidade
  const _norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const _enviarMap = {};
  if (!showMinCol && _enviarDay && typeof envios === 'object' && envios) {
    Object.values(envios).forEach(catData => {
      if (!catData.items) return;
      catData.items.forEach(planItem => {
        const q = planItem.qty && planItem.qty[unitLabel] && planItem.qty[unitLabel][_enviarDay];
        if (q > 0) _enviarMap[_norm(planItem.name)] = q;
      });
    });
  }
  // Mostrar coluna A Enviar se há mínimos definidos para a unidade e dia
  const _minPDFMap = typeof getMinPerDay === 'function' ? getMinPerDay(unitLabel) : {};
  const showEnviarCol = !showMinCol && _enviarDay && Object.keys(_minPDFMap).length > 0;

  // Larguras de coluna dinâmicas
  const colW = showMinCol
    ? [TW*0.55, TW*0.15, TW*0.15, TW*0.15]          // ITEM | UN | MIN | QTD
    : showEnviarCol
      ? [TW*0.52, TW*0.12, TW*0.18, TW*0.18]         // ITEM | UN | QTD | A ENVIAR
      : [TW*0.64, TW*0.18, TW*0.18];                  // ITEM | UN | QTD
  const colX = showMinCol
    ? [ML, ML+colW[0], ML+colW[0]+colW[1], ML+colW[0]+colW[1]+colW[2]]
    : showEnviarCol
      ? [ML, ML+colW[0], ML+colW[0]+colW[1], ML+colW[0]+colW[1]+colW[2]]
      : [ML, ML+colW[0], ML+colW[0]+colW[1]];
  let y = 0;
  const ops = [];
  const pages = [];
  // --- Bloco de assinaturas ---
  function addSignatureBlock() {
    if (y < 120) { if (ops.length) pages.push(ops.splice(0)); y = 760; }
    y -= 20;
    ops.push(ML + ' ' + y + ' m ' + (W-MR) + ' ' + y + ' l 0.6 0.6 0.6 RG S 0 0 0 RG');
    y -= 16;
    ops.push('BT /F1 9 Tf ' + ML + ' ' + y + ' Td (Assinaturas) Tj ET');
    y -= 30;
    var lw = (TW - 40) / 2;
    var x1 = ML, x2 = ML + lw + 40;
    ops.push(x1 + ' ' + y + ' m ' + (x1+lw) + ' ' + y + ' l S');
    ops.push(x2 + ' ' + y + ' m ' + (x2+lw) + ' ' + y + ' l S');
    y -= 14;
    ops.push('BT /F2 8 Tf ' + x1 + ' ' + y + ' Td (Estoquista) Tj ET');
    ops.push('BT /F2 8 Tf ' + x2 + ' ' + y + ' Td (Gerente da Unidade) Tj ET');
    y -= 6;
    ops.push('BT /F2 7 Tf ' + x1 + ' ' + y + ' Td (Nome e assinatura) Tj ET');
    ops.push('BT /F2 7 Tf ' + x2 + ' ' + y + ' Td (Nome e assinatura) Tj ET');
  }


  function newPage() {
    if (ops.length) pages.push(ops.splice(0));
    y = 780;
    // Header
    ops.push(`BT /F1 16 Tf ${ML} ${y} Td ${pdfStr("Sesconetto's - Contagem de Estoque" + (_catFilter ? ' - ' + _catFilter.join(', ') : ''))} Tj ET`);
    y -= 20;
    ops.push(`BT /F2 10 Tf ${ML} ${y} Td ${pdfStr(unitLabel + '  |  ' + dateStr + ' as ' + timeStr + '  |  ' + user)} Tj ET`);
    y -= 8;
    ops.push(`${ML} ${y} m ${W-MR} ${y} l S`);
    y -= 14;
    // Col headers com cores distintas por coluna
    ops.push(`0 0 0 rg`); // preto para ITEM e UN
    ops.push(`BT /F1 9 Tf ${colX[0]} ${y} Td (ITEM) Tj ET`);
    ops.push(`BT /F1 9 Tf ${colX[1]} ${y} Td (UN.) Tj ET`);
    if (showMinCol) {
      ops.push(`0.5 0.3 0 rg`); // marrom para MIN
      ops.push(`BT /F1 9 Tf ${colX[2]} ${y} Td (MIN.) Tj ET`);
      ops.push(`0.1 0.45 0.2 rg`); // verde escuro para QTD
      ops.push(`BT /F1 9 Tf ${colX[3]} ${y} Td (QTD) Tj ET`);
      ops.push(`0 0 0 rg`);
    } else if (showEnviarCol) {
      ops.push(`0.1 0.45 0.2 rg`); // verde para QTD
      ops.push(`BT /F1 9 Tf ${colX[2]} ${y} Td (QTD) Tj ET`);
      ops.push(`0.1 0.25 0.65 rg`); // azul para A ENVIAR
      ops.push(`BT /F1 9 Tf ${colX[3]} ${y} Td (A ENVIAR - ${_enviarDay}) Tj ET`);
      ops.push(`0 0 0 rg`);
    } else {
      ops.push(`0.1 0.45 0.2 rg`);
      ops.push(`BT /F1 9 Tf ${colX[2]} ${y} Td (QTD) Tj ET`);
      ops.push(`0 0 0 rg`);
    }
    y -= 6;
    ops.push(`${ML} ${y} m ${W-MR} ${y} l S`);
    y -= 12;
  }

  function pdfStr(s) {
    // WinAnsiEncoding: latin-1 chars (0x00-0xFF) são suportados pelo Helvetica
    // Chars acima de 0xFF são substituídos pelo equivalente mais próximo
    const latin1Map = {
      '\u0100':'A','\u0101':'a','\u0102':'A','\u0103':'a','\u0104':'A','\u0105':'a',
      '\u0106':'C','\u0107':'c','\u010C':'C','\u010D':'c',
      '\u0110':'D','\u0111':'d','\u011A':'E','\u011B':'e',
      '\u0118':'E','\u0119':'e','\u011E':'G','\u011F':'g',
      '\u0130':'I','\u0131':'i','\u0141':'L','\u0142':'l',
      '\u0143':'N','\u0144':'n','\u0147':'N','\u0148':'n',
      '\u0150':'O','\u0151':'o','\u0152':'OE','\u0153':'oe',
      '\u0158':'R','\u0159':'r','\u015A':'S','\u015B':'s',
      '\u015E':'S','\u015F':'s','\u0160':'S','\u0161':'s',
      '\u0164':'T','\u0165':'t','\u016E':'U','\u016F':'u',
      '\u0170':'U','\u0171':'u','\u0178':'Y','\u0179':'Z',
      '\u017A':'z','\u017B':'Z','\u017C':'z','\u017D':'Z','\u017E':'z',
    };
    let o = '(';
    for (const ch of String(s)) {
      const c = ch.charCodeAt(0);
      if (ch === '(') o += '\\(';
      else if (ch === ')') o += '\\)';
      else if (ch === '\\') o += '\\\\';
      else if (c < 128) o += ch;
      else if (c <= 0xFF) {
        // Latin-1: emite como octal escape — WinAnsiEncoding mapeia direto
        o += '\\' + c.toString(8).padStart(3, '0');
      } else if (latin1Map[ch]) {
        o += latin1Map[ch];
      } else {
        // Tenta normalizar para NFD e pegar só a base ASCII
        const norm = ch.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        o += norm.length > 0 && norm.charCodeAt(0) < 128 ? norm : '_';
      }
    }
    return o + ')';
  }

  // Mostrar SEMPRE todas as categorias que têm item cadastrado, contadas ou
  // não, confirmadas ou não. Achado em 26/07: existia uma regra antiga aqui
  // que restringia o PDF geral da unidade só às categorias já CONFIRMADAS —
  // isso fazia o PDF sair praticamente vazio (só cabeçalho + assinatura)
  // sempre que a unidade gerava o PDF antes de confirmar qualquer categoria.
  // O modal de seleção de categorias mascarava isso (sempre manda uma lista,
  // contornando a regra sem querer) — só ficou visível ao testar o botão
  // direto, sem o modal. Confirmação é controle de processo (fechamento do
  // dia), nunca deve decidir o que aparece impresso no PDF.
  const _catsToPrint = Object.keys(byCategory);

  newPage();
  _catsToPrint.forEach(cat => {
    if (!byCategory[cat] || byCategory[cat].length === 0) return;
    if (y < 80) newPage();
    // Category header
    ops.push(`0.85 0.93 0.87 rg ${ML} ${y-2} ${TW} 14 re f 0 0 0 rg`);
    ops.push(`BT /F1 9 Tf ${ML+3} ${y+2} Td ${pdfStr(cat.toUpperCase())} Tj ET`);
    // Nome do confirmador da categoria (apenas unidades)
    // 17/08: mostra tamb\u00e9m a data (dia operacional, 15h-3h \u2014 ver
    // _operationalDate no arquivo principal), n\u00e3o s\u00f3 a hora, mesmo motivo do
    // conserto equivalente em index.html: sem data, uma confirma\u00e7\u00e3o de dias
    // atr\u00e1s aparece igual a uma de hoje no PDF impresso.
    if (unitLabel !== 'CPD') {
      const _pSlug = typeof unitSlug === 'function' ? unitSlug(unitLabel) : '';
      const _pConf = catConfirmations[_pSlug] && catConfirmations[_pSlug][cat];
      if (_pConf) {
        const _pDia = typeof _operationalDate === 'function' ? _operationalDate(_pConf.ts).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}) : '';
        const _pTs = new Date(_pConf.ts).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
        const _pStr = '\u2713 ' + _pConf.name + '  ' + _pDia + ' ' + _pTs;
        ops.push(`BT /F2 7 Tf 0.2 0.5 0.3 rg ${ML+TW-100} ${y+3} Td ${pdfStr(_pStr)} Tj ET 0 0 0 rg`);
      }
    }
    y -= 16;
    byCategory[cat].forEach(item => {
      if (y < 60) newPage();
      const isLow = showMinCol && item.min > 0 && item.qty < item.min;
      const isZero = showMinCol && item.qty === 0 && item.min > 0;
      if (isZero) ops.push(`1 0.9 0.9 rg ${ML} ${y-2} ${TW} 13 re f 0 0 0 rg`);
      else if (isLow) ops.push(`1 0.97 0.87 rg ${ML} ${y-2} ${TW} 13 re f 0 0 0 rg`);
      // Verificar se item foi confirmado na janela atual
      // Verificar confirmação: unidades usam unitCatalog (não catalog do CPD)
      // "Não contado" = qty === 0 E não confirmado via botão ✓
      // qty > 0 = foi contado mesmo sem clicar no botão de confirmação
      let itemConfirmed = true;
      if (!showMinCol && unitLabel !== 'CPD') {
        if (item.qty > 0) {
          itemConfirmed = true;
        } else {
          const catalogItem = unitCatalog.find(i => i.name === item.name);
          itemConfirmed = catalogItem ? isConfirmed(unitLabel, catalogItem.id) : false;
        }
      }
      const itemName = itemConfirmed ? item.name : ('! nao contado ! ' + item.name);
      // ITEM (vermelho se não contado, preto se contado)
      ops.push(itemConfirmed ? `0 0 0 rg` : `0.7 0.1 0.1 rg`);
      ops.push(`BT /F2 8 Tf ${colX[0]+3} ${y+1} Td ${pdfStr(itemName)} Tj ET`);
      ops.push(`0 0 0 rg`);
      ops.push(`BT /F2 8 Tf ${colX[1]+3} ${y+1} Td ${pdfStr(item.unit)} Tj ET`);
      if (showMinCol) {
        ops.push(`0.5 0.3 0 rg`);
        ops.push(`BT /F2 8 Tf ${colX[2]+3} ${y+1} Td (${item.min > 0 ? item.min : '-'}) Tj ET`);
        ops.push(`0.1 0.45 0.2 rg`);
        ops.push(`BT /F1 9 Tf ${colX[3]+3} ${y+1} Td (${item.qty}) Tj ET`);
        ops.push(`0 0 0 rg`);
      } else if (showEnviarCol) {
        // QTD em verde
        ops.push(`0.1 0.45 0.2 rg`);
        ops.push(`BT /F1 9 Tf ${colX[2]+3} ${y+1} Td (${item.qty !== undefined ? item.qty : '-'}) Tj ET`);
        // A ENVIAR: max(0, Mínimo do Dia de Entrega − Estoque Atual)
        // Se o item não foi contado nesta janela, não calculamos "a enviar" a
        // partir de um zero falso — mostramos "NC" (não contado) em vez de número.
        const _estoqueAtual = item.qty || 0;
        const _aEnviar = itemConfirmed ? calcAEnviar(unitLabel, item.key, _estoqueAtual, _enviarDay) : 0;
        ops.push(itemConfirmed ? `0.1 0.25 0.65 rg` : `0.7 0.45 0.05 rg`);
        ops.push(`BT /F1 9 Tf ${colX[3]+3} ${y+1} Td ${itemConfirmed ? ('(' + (_aEnviar > 0 ? _aEnviar : '-') + ')') : '(NC)'} Tj ET`);
        // Fundo azul claro na célula A ENVIAR se tiver valor
        if (itemConfirmed && _aEnviar > 0) {
          const envX = colX[3]; const colWEnv = colW[3];
          ops.splice(ops.length - 1, 0,
            `0.88 0.93 0.98 rg ${envX} ${y-2} ${colWEnv} 13 re f 0 0 0 rg`,
            `0.1 0.25 0.65 rg`
          );
        }
        ops.push(`0 0 0 rg`);
      } else {
        ops.push(`0.1 0.45 0.2 rg`);
        ops.push(`BT /F1 9 Tf ${colX[2]+3} ${y+1} Td (${item.qty !== undefined ? item.qty : '-'}) Tj ET`);
        ops.push(`0 0 0 rg`);
      }
      ops.push(`${ML} ${y-3} m ${W-MR} ${y-3} l 0.9 0.9 0.9 RG S 0 0 0 RG`);
      y -= 14;
    });
    y -= 4;
  });
  addSignatureBlock();
  if (ops.length) pages.push(ops.splice(0));

  // Build PDF
  const font1 = '<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Helvetica-Bold\n/Encoding /WinAnsiEncoding\n>>';
  const font2 = '<<\n/Type /Font\n/Subtype /Type1\n/BaseFont /Helvetica\n/Encoding /WinAnsiEncoding\n>>';
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  let offset = pdf.length;

  function addObj(n, content) {
    offsets[n] = offset;
    const obj = `${n} 0 obj\n${content}\nendobj\n`;
    pdf += obj; offset += obj.length;
  }

  addObj(1, font1);
  addObj(2, font2);
  addObj(3, `<<\n/Type /Resources\n/Font <<\n/F1 1 0 R\n/F2 2 0 R\n>>\n>>`);

  const pageIds = [];
  const baseObj = 4;
  pages.forEach((pageOps, pi) => {
    const NL = String.fromCharCode(10);
  const stream = pageOps.join(String.fromCharCode(10));
    const lenObj = baseObj + pi*2;
    const pageObj = baseObj + pi*2 + 1;
    addObj(lenObj, `<<\n/Length ${stream.length}\n>>\nstream\n${stream}\nendstream`);
    addObj(pageObj, `<<\n/Type /Page\n/Parent ${baseObj + pages.length*2} 0 R\n/MediaBox [0 0 ${W} 842]\n/Contents ${lenObj} 0 R\n/Resources 3 0 R\n>>`);
    pageIds.push(pageObj);
  });

  const pagesObj = baseObj + pages.length*2;
  addObj(pagesObj, `<<\n/Type /Pages\n/Kids [${pageIds.map(i=>`${i} 0 R`).join(' ')}]\n/Count ${pages.length}\n>>`);
  const catObj = pagesObj + 1;
  addObj(catObj, `<<\n/Type /Catalog\n/Pages ${pagesObj} 0 R\n>>`);

  const xrefOffset = offset;
  const total = catObj + 1;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) xref += `${String(offsets[i]||0).padStart(10,'0')} 00000 n \n`;
  pdf += xref + `trailer\n<<\n/Size ${total}\n/Root ${catObj} 0 R\n>>\nstartxref\n${xrefOffset}\n%%EOF`;

  // _catFilter j\u00e1 normaliza onlyCategory pra array (string \u00fanica ou v\u00e1rias
  // categorias do modal de sele\u00e7\u00e3o) \u2014 usa ele aqui em vez do onlyCategory
  // cru, que quebrava (.toLowerCase n\u00e3o existe em array) quando vinha mais
  // de uma categoria selecionada.
  const catSlug = _catFilter
    ? '-' + (_catFilter.length === 1 ? _catFilter[0] : _catFilter.length + '-categorias')
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'-')
    : '';
  const fname = `contagem-${unitLabel.toLowerCase().replace(/\s+/g,'-')}${catSlug}-${now.toISOString().slice(0,10)}.pdf`;
  _baixarPdfString(pdf, fname);
  // Sem esse aviso, o download acontece silenciosamente — principalmente no
  // celular, onde não aparece nenhuma notificação visível — e dá a impressão
  // de que "não aconteceu nada" mesmo quando o PDF foi gerado com sucesso.
  if (typeof toast === 'function') toast('✓ PDF gerado! Confira nos downloads do seu aparelho.');
}
function gerarPdfEnvios(tipo) {
  const day     = nextEnviarDay();
  const dayFull = {SEG:'Segunda-feira', QUA:'Quarta-feira', SEX:'Sexta-feira'}[day] || day;
  const titulo  = tipo === 'produzido' ? 'Lista de Producao' : 'Lista de Compras';
  const _norm   = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();

  // Coletar itens com falta no CPD filtrados por tipo
  const linhas = [];
  const relevantPairs = new Set();
  const naoContados = []; // itens com estoque 0 e não contados nesta janela — não entram no cálculo, mas são avisados
  UNIT_NAMES.forEach(unitName => {
    const ucat   = getUnitCatalog(unitName).catalog;
    const ustock = unitStock[unitName] || {};
    const minMap = getMinPerDay(unitName);
    ucat.forEach(item => {
      if (classificarItem(item.name) !== tipo) return;
      const estUnit = ustock[item.id] || 0;
      // Item com estoque 0 e ainda não contado nesta janela: não sabemos o
      // valor real, então não tratamos como "zero de verdade" no cálculo —
      // só avisamos, em vez de silenciosamente considerar que a unidade tem 0.
      if (!itemFoiContado(unitName, item.id, estUnit)) {
        const minEntry = minMap[item.key];
        const minDia = minEntry ? (minEntry[day] || 0) : 0;
        if (minDia > 0) naoContados.push(unitName + ' - ' + item.name);
        return;
      }
      const aEnviar = calcAEnviar(unitName, item.key, estUnit, day);
      if (aEnviar === 0) return; // sem mínimo ou unidade já tem
      relevantPairs.add(unitName + '|' + item.category);
      const cpdItem = (catalog || []).find(c => c.key === item.key);
      const estCPD  = cpdItem ? (cpd[cpdItem.id] || 0) : 0;
      const falta   = Math.max(0, aEnviar - estCPD);
      if (falta === 0) return;
      const existing = linhas.find(l => l.key === item.key);
      if (existing) {
        existing.falta += falta;
        existing.detalhe += ', ' + unitName + ' (' + aEnviar + ')';
      } else {
        linhas.push({ name: item.name, key: item.key, unit: item.unit, falta,
                      category: categoriaCanonica(item.key, item.category), detalhe: unitName + ' (' + aEnviar + ')' });
      }
    });
  });

  const staleEntries = [];
  relevantPairs.forEach(pair => {
    const [unitName, cat] = pair.split('|');
    const st = getCategoryStaleness(unitName, cat);
    if (st) {
      staleEntries.push(unitName + ' - ' + cat + (st.never
        ? ' (nunca confirmada)'
        : ' (' + st.days + (st.days === 1 ? ' dia' : ' dias') + ' atr\u00E1s)'));
    }
  });
  // Itens com m\u00EDnimo pro dia mas ainda n\u00E3o contados nesta janela \u2014 n\u00E3o entraram
  // no c\u00E1lculo acima porque n\u00E3o sabemos se s\u00E3o zero de verdade, mas \u00E9 importante
  // avisar: podem estar faltando sem aparecer na lista.
  if (naoContados.length > 0) {
    staleEntries.push('N\u00C3O CONTADOS (podem estar faltando e n\u00E3o aparecem na lista): ' + naoContados.join(', '));
  }

  if (linhas.length === 0) {
    if (naoContados.length > 0) {
      toast('Nenhum item calculado, mas há ' + naoContados.length + ' item(ns) ainda não contado(s) que podem estar faltando. Confira as unidades antes de assumir que está tudo certo.');
    } else {
      toast((tipo === 'produzido' ? 'Nenhum item de producao' : 'Nenhum item de compra') + ' faltando para ' + dayFull);
    }
    return;
  }

  // Ordenar por categoria depois posição — usa a ordem do catálogo da Asa Sul,
  // que é o formato de referência para estas telas agregadas do CPD.
  const refCats = getUnitCatalog('Asa Sul').categories;
  linhas.sort((a, b) => {
    const ia = refCats.indexOf(a.category), ib = refCats.indexOf(b.category);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  // ── PDF Multipágina ──────────────────────────────────────────────────────
  function rgb(r,g,b) { return (r/255).toFixed(3)+' '+(g/255).toFixed(3)+' '+(b/255).toFixed(3); }
  const W = 595.28, H = 841.89, ml = 40, mr = 40;
  const col = [ml+2, ml+162, ml+212, ml+272];
  const rowH = 15, MARGIN_BOT = 50;
  const genDate = new Date().toLocaleDateString('pt-BR');

  function wrapText(text, maxChars) {
    const words = text.split(', '); const lines = []; let cur = '';
    words.forEach(w => {
      const test = cur ? cur+', '+w : w;
      if (test.length > maxChars && cur) { lines.push(cur); cur = w; } else cur = test;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  const pages = [];
  let cmds = [];
  const c = (...p) => cmds.push(p.join(' '));

  function newPage() {
    cmds = [];
    const warnLines = staleEntries.length > 0
      ? wrapText('\u26A0 Contagem desatualizada usada no c\u00E1lculo: ' + staleEntries.join('; '), 95)
      : [];
    const extraH = warnLines.length * 11;
    c(rgb(12,26,15)+' rg', ml+' '+(H-50-extraH)+' '+(W-80)+' '+(40+extraH)+' re f');
    c('BT /F1 13 Tf '+rgb(240,237,224)+' rg '+(ml+8)+' '+(H-34)+' Td '+pdfStr(titulo+' - '+dayFull)+' Tj ET');
    c('BT /F2 8 Tf '+rgb(168,196,174)+' rg '+(W-mr-80)+' '+(H-34)+' Td '+pdfStr(genDate)+' Tj ET');
    c('BT /F2 9 Tf '+rgb(168,196,174)+' rg '+(ml+8)+' '+(H-48)+' Td '+pdfStr(linhas.length+' itens com falta no CPD')+' Tj ET');
    warnLines.forEach((wl, wi) => {
      c('BT /F1 8 Tf '+rgb(255,214,120)+' rg '+(ml+8)+' '+(H-48-12-wi*11)+' Td '+pdfStr(wl)+' Tj ET');
    });
    c(rgb(184,146,42)+' RG 0.8 w '+ml+' '+(H-58-extraH)+' m '+(W-mr)+' '+(H-58-extraH)+' l S');
    const thY = H-78-extraH;
    c(rgb(38,116,62)+' rg '+ml+' '+thY+' '+(W-ml-mr)+' 18 re f');
    ['ITEM','UN','FALTA','PARA - UNIDADES'].forEach((h,i) => {
      c('BT /F1 8 Tf 1 1 1 rg '+col[i]+' '+(thY+5)+' Td '+pdfStr(h)+' Tj ET');
    });
    return thY - 2;
  }

  function closePage() {
    c(rgb(218,215,197)+' RG 0.5 w '+ml+' 36 m '+(W-mr)+' 36 l S');
    c('BT /F2 8 Tf '+rgb(154,152,128)+' rg '+ml+' 24 Td '+pdfStr("Sesconetto's Pizzeria  -  Sistema de Estoque")+' Tj ET');
    pages.push(cmds.slice());
  }

  let y = newPage();
  let lastCat = null;
  let rowIdx = 0;

  linhas.forEach(row => {
    const detLines = wrapText(row.detalhe, 52);
    const dynH = Math.max(rowH, 8 + detLines.length * 10);
    const catH = (row.category !== lastCat) ? 15 : 0;

    if (y - catH - dynH < MARGIN_BOT) {
      closePage();
      y = newPage();
      lastCat = null;
    }

    if (row.category !== lastCat) {
      lastCat = row.category;
      c(rgb(220,238,224)+' rg '+ml+' '+(y-13)+' '+(W-ml-mr)+' 14 re f');
      c('BT /F1 8 Tf '+rgb(16,48,22)+' rg '+(ml+4)+' '+(y-9)+' Td '+pdfStr(row.category.toUpperCase())+' Tj ET');
      y -= 15;
    }

    if (rowIdx%2===0) c(rgb(253,252,247)+' rg '+ml+' '+(y-dynH)+' '+(W-ml-mr)+' '+dynH+' re f');
    else              c(rgb(245,242,232)+' rg '+ml+' '+(y-dynH)+' '+(W-ml-mr)+' '+dynH+' re f');

    const midY = y - dynH/2 - 3;
    const nm = row.name.length > 36 ? row.name.substring(0,36)+'...' : row.name;
    c('BT /F2 9 Tf '+rgb(26,26,18)+' rg '+col[0]+' '+midY+' Td '+pdfStr(nm)+' Tj ET');
    c('BT /F2 9 Tf '+rgb(26,26,18)+' rg '+col[1]+' '+midY+' Td '+pdfStr(row.unit)+' Tj ET');
    c('BT /F1 10 Tf '+rgb(180,40,40)+' rg '+col[2]+' '+midY+' Td ('+row.falta+') Tj ET');
    detLines.forEach((dl,di) => {
      c('BT /F2 7.5 Tf '+rgb(60,60,60)+' rg '+col[3]+' '+((y-6)-di*10)+' Td '+pdfStr(dl)+' Tj ET');
    });
    c(rgb(218,215,197)+' RG 0.3 w '+ml+' '+(y-dynH)+' m '+(W-mr)+' '+(y-dynH)+' l S');
    y -= dynH;
    rowIdx++;
  });
  closePage();

  // Montar PDF multipágina
  const objs = [];
  function addObj(cnt) { const id=objs.length+1; objs.push({id,content:cnt}); return id; }
  const f1id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const f2id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageObjIds = [];
  pages.forEach(pageCmds => {
    const sc = pageCmds.join(String.fromCharCode(10));
    const NL2=String.fromCharCode(10); const sid = addObj('<< /Length '+sc.length+' >>'+NL2+'stream'+NL2+sc+NL2+'endstream');
    const pid = addObj('<< /Type /Page /Parent 999 0 R /MediaBox [0 0 '+W+' '+H+'] /Contents '+sid+' 0 R /Resources << /Font << /F1 '+f1id+' 0 R /F2 '+f2id+' 0 R >> >> >>');
    pageObjIds.push(pid);
  });
  const pagesId = objs.length + 1;
  const catId   = addObj('<< /Type /Catalog /Pages '+(pagesId+1)+' 0 R >>');
  addObj('<< /Type /Pages /Kids ['+pageObjIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pages.length+' >>');
  objs.forEach(obj => { obj.content = obj.content.replace('/Parent 999 0 R','/Parent '+pagesId+' 0 R'); });

  let out = '%PDF-1.4'+String.fromCharCode(10)+'%'+String.fromCharCode(255,255,255,255)+String.fromCharCode(10);
  const offsets = [];
  objs.forEach(obj => { offsets.push(out.length); out += obj.id+' 0 obj'+String.fromCharCode(10)+obj.content+String.fromCharCode(10)+'endobj'+String.fromCharCode(10); });
  const xrefOff = out.length;
  out += 'xref'+String.fromCharCode(10)+'0 '+(objs.length+1)+String.fromCharCode(10)+'0000000000 65535 f '+String.fromCharCode(10);
  offsets.forEach(o => { out += String(o).padStart(10,'0')+' 00000 n '+String.fromCharCode(10); });
  out += 'trailer'+String.fromCharCode(10)+'<< /Size '+(objs.length+1)+' /Root '+catId+' 0 R >>'+String.fromCharCode(10)+'startxref'+String.fromCharCode(10)+xrefOff+String.fromCharCode(10)+'%%EOF';

  const fname = (tipo === 'produzido' ? 'Lista_Producao_' : 'Lista_Compras_') + day + '.pdf';
  _baixarPdfString(out, fname);
  toast('PDF ' + (tipo === 'produzido' ? 'Producao' : 'Compras') + ' gerado!');
}
function gerarPdfEnviosTabela(rows, dayFull, staleEntries) {
  if (!rows || rows.length === 0) {
    toast('Nenhum item para gerar o PDF com os filtros atuais.');
    return;
  }

  function rgb(r,g,b) { return (r/255).toFixed(3)+' '+(g/255).toFixed(3)+' '+(b/255).toFixed(3); }
  const W = 595.28, H = 841.89, ml = 40, mr = 40, TW = W - ml - mr;
  const genDate = new Date().toLocaleDateString('pt-BR');
  const nUnits  = UNIT_NAMES.length;
  // Cada unidade ganha 2 sub-colunas: Est. (estoque atual) e A Env. (a enviar) —
  // mesma leitura da tabela em tela, só sem a coluna Est. CPD e sem Situação.
  const itemW      = TW * 0.28;
  const subW       = (TW - itemW) / (nUnits * 2);
  const unitGroupW = subW * 2;
  const groupX     = i => ml + itemW + i * unitGroupW;
  const rowH = 16, MARGIN_BOT = 50;
  const SEP_CLR = rgb(184,146,42); // dourado — mesmo tom do separador entre unidades na tela

  // Aviso de "não contado"/"contagem desatualizada" removido do topo do PDF —
  // era ilegível quando havia muitos itens pendentes (virava uma parede de
  // texto cobrindo várias linhas). Quem quiser essa lista, consulta pelo botão
  // "Ver lista" na tela (Envios do Dia), que abre um pop-up organizado por
  // unidade. O PDF mantém só o "NC" discreto em cada célula do item pendente.

  const pages = [];
  let cmds = [];
  const c = (...p) => cmds.push(p.join(' '));

  function newPage() {
    cmds = [];
    c(rgb(12,26,15)+' rg', ml+' '+(H-50)+' '+(W-80)+' 40 re f');
    c('BT /F1 13 Tf '+rgb(240,237,224)+' rg '+(ml+8)+' '+(H-34)+' Td '+pdfStr('Tabela de Envios - '+dayFull)+' Tj ET');
    c('BT /F2 8 Tf '+rgb(168,196,174)+' rg '+(W-mr-80)+' '+(H-34)+' Td '+pdfStr(genDate)+' Tj ET');
    c('BT /F2 9 Tf '+rgb(168,196,174)+' rg '+(ml+8)+' '+(H-48)+' Td '+pdfStr(rows.length+' itens')+' Tj ET');
    c(SEP_CLR+' RG 0.8 w '+ml+' '+(H-58)+' m '+(W-mr)+' '+(H-58)+' l S');

    // Linha 1 do cabeçalho: nome da unidade (fundo verde escuro, texto branco)
    const hdr1Top = H-58, hdr1H = 16;
    c(rgb(38,116,62)+' rg '+ml+' '+(hdr1Top-hdr1H)+' '+(W-ml-mr)+' '+hdr1H+' re f');
    c('BT /F1 8 Tf 1 1 1 rg '+(ml+4)+' '+(hdr1Top-hdr1H+5)+' Td '+pdfStr('ITEM')+' Tj ET');

    // Linha 2 do cabeçalho: "Est." / "A Env." por unidade (fundo cinza claro)
    const hdr2Top = hdr1Top - hdr1H, hdr2H = 15;
    c(rgb(245,242,232)+' rg '+ml+' '+(hdr2Top-hdr2H)+' '+(W-ml-mr)+' '+hdr2H+' re f');

    UNIT_NAMES.forEach((u, i) => {
      const gx = groupX(i);
      // Separador vertical mais forte entre cada unidade — atravessa as duas
      // linhas do cabeçalho, para deixar claro onde uma unidade termina e a
      // próxima começa.
      c(SEP_CLR+' RG 1.1 w '+gx+' '+(hdr1Top-hdr1H)+' m '+gx+' '+(hdr2Top-hdr2H)+' l S');
      const nmW = u.length > 13 ? u.substring(0,13) : u;
      c('BT /F1 6.5 Tf 1 1 1 rg '+(gx+3)+' '+(hdr1Top-hdr1H+5.5)+' Td '+pdfStr(nmW.toUpperCase())+' Tj ET');
      c('BT /F1 6.5 Tf '+rgb(114,109,79)+' rg '+(gx+3)+' '+(hdr2Top-hdr2H+5)+' Td '+pdfStr('Est.')+' Tj ET');
      c('BT /F1 6.5 Tf '+rgb(114,109,79)+' rg '+(gx+3+subW)+' '+(hdr2Top-hdr2H+5)+' Td '+pdfStr('A Env.')+' Tj ET');
    });
    // Separador final à direita da última unidade
    c(SEP_CLR+' RG 1.1 w '+(W-mr)+' '+(hdr1Top-hdr1H)+' m '+(W-mr)+' '+(hdr2Top-hdr2H)+' l S');
    return hdr2Top - hdr2H - 2;
  }

  function closePage() {
    c(rgb(218,215,197)+' RG 0.5 w '+ml+' 36 m '+(W-mr)+' 36 l S');
    c('BT /F2 8 Tf '+rgb(154,152,128)+' rg '+ml+' 24 Td '+pdfStr("Sesconetto's Pizzeria  -  Sistema de Estoque")+' Tj ET');
    pages.push(cmds.slice());
  }

  let y = newPage();
  let lastCat = null;
  let rowIdx = 0;

  rows.forEach(row => {
    const cat  = row._catOrder || row.category;
    const catH = (cat !== lastCat) ? 15 : 0;

    if (y - catH - rowH < MARGIN_BOT) {
      closePage();
      y = newPage();
      lastCat = null;
    }

    if (cat !== lastCat) {
      lastCat = cat;
      c(rgb(220,238,224)+' rg '+ml+' '+(y-13)+' '+(W-ml-mr)+' 14 re f');
      c('BT /F1 8 Tf '+rgb(16,48,22)+' rg '+(ml+4)+' '+(y-9)+' Td '+pdfStr(cat.toUpperCase())+' Tj ET');
      y -= 15;
    }

    if (rowIdx%2===0) c(rgb(253,252,247)+' rg '+ml+' '+(y-rowH)+' '+(W-ml-mr)+' '+rowH+' re f');
    else              c(rgb(245,242,232)+' rg '+ml+' '+(y-rowH)+' '+(W-ml-mr)+' '+rowH+' re f');

    const midY     = y - rowH/2 - 3;
    const maxChars = Math.floor(itemW / 5.2);
    const nm = row.name.length > maxChars ? row.name.substring(0, maxChars-3)+'...' : row.name;
    c('BT /F2 9 Tf '+rgb(26,26,18)+' rg '+(ml+4)+' '+midY+' Td '+pdfStr(nm)+' Tj ET');

    UNIT_NAMES.forEach((u, i) => {
      const gx  = groupX(i);
      // Separador vertical entre unidades, descendo por toda a altura da linha
      c(SEP_CLR+' RG 0.6 w '+gx+' '+y+' m '+gx+' '+(y-rowH)+' l S');

      const pu    = row.perUnit ? row.perUnit[u] : null;
      const hasPu = !!pu;
      // 28/07: só é "NC" se a unidade também tem mínimo relevante pra esse
      // dia — sem isso, não contar não muda nada no envio de hoje.
      const naoContado = hasPu && pu.contado === false && pu.minDia > 0;
      const hasEnv = hasPu && !naoContado && pu.aEnviar > 0;
      const estVal = hasPu ? String(pu.est) : '-';
      const envVal = naoContado ? 'NC' : (hasEnv ? String(pu.aEnviar) : '-');
      const estClr = hasPu ? rgb(70,68,58) : rgb(160,158,140);
      const envClr = naoContado ? rgb(184,116,13) : (hasEnv ? rgb(26,82,41) : rgb(160,158,140));
      c('BT /F2 8.5 Tf '+estClr+' rg '+(gx+3)+' '+midY+' Td '+pdfStr(estVal)+' Tj ET');
      c('BT /F1 8.5 Tf '+envClr+' rg '+(gx+3+subW)+' '+midY+' Td '+pdfStr(envVal)+' Tj ET');
    });
    c(SEP_CLR+' RG 0.6 w '+(W-mr)+' '+y+' m '+(W-mr)+' '+(y-rowH)+' l S');

    c(rgb(218,215,197)+' RG 0.3 w '+ml+' '+(y-rowH)+' m '+(W-mr)+' '+(y-rowH)+' l S');
    y -= rowH;
    rowIdx++;
  });
  closePage();

  // Montar PDF multipágina
  const objs = [];
  function addObj(cnt) { const id=objs.length+1; objs.push({id,content:cnt}); return id; }
  const f1id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const f2id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pageObjIds = [];
  pages.forEach(pageCmds => {
    const sc = pageCmds.join(String.fromCharCode(10));
    const NL2=String.fromCharCode(10); const sid = addObj('<< /Length '+sc.length+' >>'+NL2+'stream'+NL2+sc+NL2+'endstream');
    const pid = addObj('<< /Type /Page /Parent 999 0 R /MediaBox [0 0 '+W+' '+H+'] /Contents '+sid+' 0 R /Resources << /Font << /F1 '+f1id+' 0 R /F2 '+f2id+' 0 R >> >> >>');
    pageObjIds.push(pid);
  });
  const pagesId = objs.length + 1;
  const catId   = addObj('<< /Type /Catalog /Pages '+(pagesId+1)+' 0 R >>');
  addObj('<< /Type /Pages /Kids ['+pageObjIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pages.length+' >>');
  objs.forEach(obj => { obj.content = obj.content.replace('/Parent 999 0 R','/Parent '+pagesId+' 0 R'); });

  let out = '%PDF-1.4'+String.fromCharCode(10)+'%'+String.fromCharCode(255,255,255,255)+String.fromCharCode(10);
  const offsets = [];
  objs.forEach(obj => { offsets.push(out.length); out += obj.id+' 0 obj'+String.fromCharCode(10)+obj.content+String.fromCharCode(10)+'endobj'+String.fromCharCode(10); });
  const xrefOff = out.length;
  out += 'xref'+String.fromCharCode(10)+'0 '+(objs.length+1)+String.fromCharCode(10)+'0000000000 65535 f '+String.fromCharCode(10);
  offsets.forEach(o => { out += String(o).padStart(10,'0')+' 00000 n '+String.fromCharCode(10); });
  out += 'trailer'+String.fromCharCode(10)+'<< /Size '+(objs.length+1)+' /Root '+catId+' 0 R >>'+String.fromCharCode(10)+'startxref'+String.fromCharCode(10)+xrefOff+String.fromCharCode(10)+'%%EOF';

  // 28/07: nome do arquivo reflete os dias somados (ex.: "QUA", "QUA-SEX",
  // "SEG-QUA-SEX"), pra não ficar um PDF chamado "Tabela_Envios_QUA" com
  // dado de quarta+sexta somado dentro. dayFull chega como "Quarta-feira"
  // (um dia só) ou "SEG + QUA (soma)" (mais de um dia) — em ambos os casos
  // dá pra extrair os códigos SEG/QUA/SEX direto do texto.
  const _codigosNoTexto = (dayFull || '').match(/SEG|QUA|SEX|Segunda|Quarta|Sexta/g) || [];
  const _diasSlug = _codigosNoTexto
    .map(s => ({SEG:'SEG', QUA:'QUA', SEX:'SEX', Segunda:'SEG', Quarta:'QUA', Sexta:'SEX'}[s] || ''))
    .filter(Boolean)
    .join('-') || (typeof nextEnviarDay === 'function' ? nextEnviarDay() : Date.now());
  const fname = 'Tabela_Envios_' + _diasSlug + '.pdf';
  _baixarPdfString(out, fname);
  toast('PDF da tabela de envios gerado!');
}
function qpGerarPDF() {
  const dayIdx  = qpGet('activeDay', 0);
  const dayName = QP_DIAS[dayIdx];
  const today   = new Date();
  const diff    = dayIdx - ((new Date().getDay() + 6) % 7);
  const d       = new Date(today); d.setDate(d.getDate() + diff);
  const dateStr = d.toLocaleDateString('pt-BR', {weekday:'long',day:'2-digit',month:'long',year:'numeric'});

  let body = '';
  QP_AREAS.forEach(area => {
    const items = FT_LIBRARY.filter(f => f.area === area);
    let linhas = '';
    items.forEach(ft => {
      const lotes = qpGet(`qty_${dayIdx}_${ft.id}`, 0);
      if (!lotes) return;
      const lib = qpGet(`lib_${dayIdx}_${ft.id}`, false);
      const obs = qpGet(`obs_${dayIdx}_${ft.id}`, '');
      let ins = ft.mp.map(i => `${i.n}: <b>${+(i.q*lotes).toFixed(2)} ${i.u}</b>`).join('<br>');
      if (ft.emb && ft.emb.length) ins += '<br>' + ft.emb.map(i =>
        `<span style="color:#2a5080">[emb] ${i.n}: <b>${+(i.q*lotes).toFixed(2)} ${i.u}</b></span>`
      ).join('<br>');
      linhas += `<tr>
        <td class="nm">${lib ? '✓ ' : ''}${ft.nome}<br><span class="rend">${ft.rendimento}</span></td>
        <td class="ct">${lotes}</td>
        <td>${obs}</td>
        <td>${ins || '—'}</td>
      </tr>`;
    });
    if (!linhas) return;
    body += `<h2>${area}</h2>
      <table><thead><tr><th>Preparo</th><th>Lotes</th><th>Obs</th><th>Insumos + Embalagens</th></tr></thead>
      <tbody>${linhas}</tbody></table>`;
  });

  const win = window.open('','_blank');
  if (!win) { toast('Permita pop-ups para gerar o PDF'); return; }
  win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Ordem de Produção — ${dayName}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',Arial,sans-serif;color:#111;padding:20px;font-size:12px}
      h1{font-size:17px;margin-bottom:2px}
      .sub{color:#555;font-size:11px;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #111}
      h2{font-size:13px;margin:16px 0 5px;background:#e8f5ec;padding:5px 8px;border-left:4px solid #1A5229;color:#1a3d26}
      table{width:100%;border-collapse:collapse;margin-bottom:8px}
      th{background:#f0f0f0;border:1px solid #bbb;padding:5px 6px;text-align:left;font-size:10px;text-transform:uppercase}
      td{border:1px solid #ccc;padding:5px 6px;vertical-align:top;font-size:11px}
      td.nm{font-weight:bold;width:22%}.ct{text-align:center;width:7%}
      .rend{font-size:10px;color:#666;font-weight:normal}
      @media print{body{padding:0}h2{page-break-after:avoid}tr{page-break-inside:avoid}}
    </style></head><body>
    <h1>ORDEM DE PRODUÇÃO — CPD SESCONETTO'S</h1>
    <div class="sub">${dayName} · ${dateStr}</div>
    ${body || '<p style="color:#999;padding:20px">Nenhum item com quantidade definida para este dia.</p>'}
    </body></html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
  toast('PDF aberto — Salvar como PDF na impressão');
}
