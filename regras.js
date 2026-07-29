/* ============================================================
   regras.js — Regras de negócio (sem nada de tela/DOM)
   ------------------------------------------------------------
   Extraído de work.html/index.html em 29/07 como passo 4 da
   desmembração do arquivo único (depois do dados.js e do
   pdf.js). Carregado via <script src="regras.js"> comum (NÃO
   type="module") — mesmo esquema dos outros: continua no mesmo
   escopo global de sempre.

   O critério de corte aqui foi: toda função do arquivo principal
   que NÃO constrói nem mexe em tela (nada de el(), document.,
   innerHTML, addEventListener, appendChild, etc.) — ou seja,
   cálculo, regra de data/janela de contagem, leitura/gravação no
   Firebase e no localStorage, classificação de item, etc. As
   funções que desenham tela (viewCpd, viewUnits, viewEnviosDia,
   viewCatalogo, viewQuadroProducao, buildSidebarNav, modais, etc.)
   continuam no arquivo principal — são maiores, mais entrelaçadas
   entre si, e um corte seguro delas é um passo à parte, ainda não
   feito.

   IMPORTANTE: este arquivo precisa carregar ANTES do arquivo
   principal (igual o dados.js) — o script principal usa load() e
   _ensureItemKeys() já nas primeiras linhas que rodam ao abrir o
   app, não só dentro de função chamada depois.

   Nenhum comportamento foi alterado nesta extração — é só um
   recorte de texto, função por função, na ordem em que apareciam
   no arquivo original.
   ============================================================ */

function getDailyRequiredCategories(date) {
  const now = date || new Date();
  const brt = new Date(now.getTime() - 3*60*60*1000); // UTC-3
  const extras = DAILY_REQUIRED_CATEGORIES_BY_WEEKDAY[brt.getDay()] || [];
  return DAILY_REQUIRED_CATEGORIES.concat(extras.filter(c => !DAILY_REQUIRED_CATEGORIES.includes(c)));
}

function formatCategoryList(cats) {
  if (!cats || cats.length === 0) return '';
  if (cats.length === 1) return cats[0];
  return cats.slice(0, -1).join(', ') + ' e ' + cats[cats.length - 1];
}

function _ensureItemKeys(arr) {
  if (!Array.isArray(arr)) return arr;
  const _n = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  arr.forEach(item => {
    if (item && !item.key) item.key = _n(item.name);
  });
  return arr;
}

function getUnitCatalog(unitName) {
  // Priorizar cache em memória (versão editada) sobre seed hardcoded
  const slug = typeof unitSlug === 'function' ? unitSlug(unitName) : (unitName||'').toLowerCase().replace(/[^a-z0-9]+/g,'_');
  if (window._unitCatalogCache && window._unitCatalogCache[slug]) {
    // Derivar categorias do catálogo em cache (preserva ordem de edição)
    const cachedCat = _ensureItemKeys(window._unitCatalogCache[slug]);
    const cats = [...new Set(cachedCat.map(i => i.category))];
    return { catalog: cachedCat, categories: cats };
  }
  // Fallback: seed hardcoded
  switch(unitName) {
    case 'Asa Sul':       return { catalog: ASA_SUL_CATALOG,       categories: ASA_SUL_CATEGORIES };
    case 'SIG':           return { catalog: SIG_CATALOG,           categories: SIG_CATEGORIES };
    case 'Vicente Pires': return { catalog: VICENTE_PIRES_CATALOG, categories: VICENTE_PIRES_CATEGORIES };
    case 'Delivery':      return { catalog: DELIVERY_CATALOG,      categories: DELIVERY_CATEGORIES };
    default:              return { catalog: ASA_SUL_CATALOG,       categories: ASA_SUL_CATEGORIES };
  }
}

function classificarItem(itemName) {
  const _n = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const nm = _n(itemName);
  // Match exato primeiro
  for (const p of ITENS_PRODUZIDOS) { if (_n(p) === nm) return 'produzido'; }
  for (const c of ITENS_COMPRADOS)  { if (_n(c) === nm) return 'comprado'; }
  // Match por prefixo (ex: 'Peperoni' bate 'Peperoni 1kg' e vice-versa)
  for (const p of ITENS_PRODUZIDOS) { if (nm.startsWith(_n(p)) || _n(p).startsWith(nm)) return 'produzido'; }
  for (const c of ITENS_COMPRADOS)  { if (nm.startsWith(_n(c)) || _n(c).startsWith(nm)) return 'comprado'; }
  return 'outro';
}

function getMinPerDay(unitName) {
  // Normalizar nome para garantir match independente de formato
  const u = (unitName || '').trim();
  if (u === 'Asa Sul'       || u === 'asa_sul')        return MIN_PER_DAY_ASA_SUL;
  if (u === 'SIG'           || u === 'sig')             return MIN_PER_DAY_SIG;
  if (u === 'Vicente Pires' || u === 'vicente_pires')   return MIN_PER_DAY_VICENTE_PIRES;
  if (u === 'Delivery'      || u === 'delivery')        return MIN_PER_DAY_DELIVERY;
  return {};
}

function itemFoiContado(unitName, itemId, qty) {
  if ((qty || 0) > 0) return true;
  if (!unitName || unitName === 'CPD') return true;
  if (typeof isConfirmed === 'function' && isConfirmed(unitName, itemId)) return true;
  // 28/07: a unidade também pode confirmar a contagem por CATEGORIA inteira
  // (botão "Confirmar" no topo de cada categoria — ver confirmCategory /
  // getCatConfirmState), sem precisar clicar no ✓ individual de cada item
  // zerado — é esse o fluxo que os funcionários realmente usam no dia a dia.
  // Antes desta correção, "Envios do Dia" no CPD ignorava esse sinal e
  // mostrava "NC" (não contado) em itens que a unidade já tinha contado e
  // confirmado por categoria, gerando divergência entre a tela da unidade
  // (tudo confirmado) e a tela do CPD (muita coisa "NC"). A confirmação por
  // categoria agora também conta como "contado" aqui. O ✓ individual por
  // item continua existindo e sendo registrado à parte — ver
  // itemConfirmadoIndividualmente(), usado no indicador de conformidade que
  // o CPD vê ao lado de cada categoria.
  if (typeof getUnitCatalog === 'function' && typeof getCatConfirmState === 'function' && typeof unitStock !== 'undefined') {
    const item = getUnitCatalog(unitName).catalog.find(c => c.id === itemId);
    if (item) {
      const stockObj = unitStock[unitName] || {};
      if (getCatConfirmState(unitName, item.category, stockObj) === 'confirmed') return true;
    }
  }
  return false;
}

function itemConfirmadoIndividualmente(unitName, itemId) {
  return typeof isConfirmed === 'function' ? isConfirmed(unitName, itemId) : false;
}

function categoriaCanonica(itemKey, categoriaFallback) {
  const asaSulItem = (typeof getUnitCatalog === 'function')
    ? getUnitCatalog('Asa Sul').catalog.find(c => c.key === itemKey) : null;
  return asaSulItem ? asaSulItem.category : categoriaFallback;
}

function _acharMinEntry(minMap, itemKeyOrName) {
  let entry = minMap[itemKeyOrName];
  if (!entry) {
    const _norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
    const k = Object.keys(minMap).find(k => _norm(k) === _norm(itemKeyOrName));
    entry = k ? minMap[k] : null;
  }
  return entry;
}

function calcAEnviar(unitName, itemKeyOrName, estoqueAtual, dayCode) {
  const minMap = getMinPerDay(unitName);
  const entry = _acharMinEntry(minMap, itemKeyOrName);
  if (!entry) return 0;
  const minDia = entry[dayCode] || 0;
  return Math.max(0, minDia - (estoqueAtual || 0));
}

function somaMinDias(entry, dayCodes) {
  if (!entry) return 0;
  return (dayCodes || []).reduce((s, d) => s + (entry[d] || 0), 0);
}

function calcAEnviarDias(unitName, itemKeyOrName, estoqueAtual, dayCodes) {
  const minMap = getMinPerDay(unitName);
  const entry = _acharMinEntry(minMap, itemKeyOrName);
  if (!entry) return 0;
  const minAlvo = somaMinDias(entry, dayCodes);
  return Math.max(0, minAlvo - (estoqueAtual || 0));
}

function nextEnviarDay() {
  const now = new Date();
  const dow = now.getDay();
  const passouCorte = now.getHours() >= HORA_CORTE_ENVIO_DIA;
  const dmap = {1:'SEG', 3:'QUA', 5:'SEX'};
  for (let d = 0; d <= 6; d++) {
    if (d === 0 && passouCorte) continue; // envio de hoje já passou do horário de corte
    const dd = (dow + d) % 7;
    if (dmap[dd]) return dmap[dd];
  }
  return 'SEG';
}

function nextEnviarDate() {
  const now = new Date();
  const dow = now.getDay();
  const passouCorte = now.getHours() >= HORA_CORTE_ENVIO_DIA;
  const dmap = {1:'SEG', 3:'QUA', 5:'SEX'};
  for (let d = 0; d <= 6; d++) {
    if (d === 0 && passouCorte) continue; // envio de hoje já passou do horário de corte
    const dd = (dow + d) % 7;
    if (dmap[dd]) {
      const dt = new Date(now);
      dt.setDate(now.getDate() + d);
      return dt;
    }
  }
  const dt = new Date(now);
  dt.setDate(now.getDate() + 7);
  return dt;
}

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    const parsed = JSON.parse(v);
    // Return fallback if result is an empty array but fallback is not
    if (Array.isArray(parsed) && parsed.length === 0 && Array.isArray(fallback) && fallback.length > 0) return fallback;
    return parsed;
  }
  catch(e) { return fallback; }
}

function qpLoad() {
  try { return JSON.parse(localStorage.getItem(_QP_KEY) || '{}'); } catch(e) { return {}; }
}

function qpSave(s) {
  try { localStorage.setItem(_QP_KEY, JSON.stringify(s)); } catch(e) {}
}

function qpGet(key, def) { return _qpState[key] !== undefined ? _qpState[key] : def; }

function qpSet(key, val) { _qpState[key] = val; qpSave(_qpState); }

function _checkDailyReset() {
  // Intencionalmente vazio — ver comentário acima.
}

function confirmCategory(unitName, cat, respName, stockObj) {
  if (unitName !== 'CPD' && typeof unitStock !== 'undefined' && unitStock[unitName]) {
    stockObj = unitStock[unitName];
  }
  const slug = unitSlug(unitName);
  if (!catConfirmations[slug]) catConfirmations[slug] = {};
  const qtys = {};
  const ucat = getUnitCatalog(unitName).catalog.filter(i => i.category === cat);
  ucat.forEach(i => { qtys[i.id] = stockObj[i.id] || 0; });
  catConfirmations[slug][cat] = {
    name: respName,
    ts: Date.now(),
    qtys
  };
  save('pizza_cat_confirms', catConfirmations);
}

function getCatConfirmState(unitName, cat, stockObj) {
  _checkDailyReset();
  if (unitName !== 'CPD' && typeof unitStock !== 'undefined' && unitStock[unitName]) {
    stockObj = unitStock[unitName];
  }
  const slug = unitSlug(unitName);
  const conf = catConfirmations[slug] && catConfirmations[slug][cat];
  if (!conf) return 'none';
  // Verificar se alguma quantidade mudou desde a confirmação
  const ucat = getUnitCatalog(unitName).catalog.filter(i => i.category === cat);
  const changed = ucat.some(i => (stockObj[i.id] || 0) !== (conf.qtys[i.id] || 0));
  return changed ? 'needs-reconfirm' : 'confirmed';
}

function hasAnyCategoryConfirmed(unitName, stockObj) {
  const slug  = unitSlug(unitName);
  const confs = catConfirmations[slug];
  if (!confs) return false;
  return Object.keys(confs).some(cat => getCatConfirmState(unitName, cat, stockObj) === 'confirmed');
}

function dailyRequiredCatsConfirmed(unitName, stockObj) {
  const unitCats = getUnitCatalog(unitName).categories;
  const required = getDailyRequiredCategories().filter(cat => unitCats.includes(cat));
  if (required.length === 0) return false; // unidade sem essas categorias — não se aplica
  return required.every(cat => getCatConfirmState(unitName, cat, stockObj) === 'confirmed');
}

function confirmGeneral(unitName, respName) {
  const slug = unitSlug(unitName);
  if (!catConfirmations[slug]) catConfirmations[slug] = {};
  catConfirmations[slug]._general = { name: respName, ts: Date.now() };
  save('pizza_cat_confirms', catConfirmations);
  // Salvar snapshot de histórico
  saveHistoricoSnapshot(unitName, respName);
}

function saveHistoricoSnapshot(unitName, respName) {
  if (!window._fb || !window._fb.ready || typeof db === 'undefined') return;
  const slug    = unitSlug(unitName);
  // CPD é um caso à parte: usa o estoque global "cpd" e o catálogo global
  // "catalog" (códigos rf01/es02/br05...), não unitStock/getUnitCatalog
  // (que são das 4 lojas, com códigos ur01/ub01/us12...). Adicionado 29/07
  // pra dar data/hora à contagem do CPD, igual as lojas já tinham (pedido
  // do chefe do Eduardo, item 1 da lista de prioridade).
  const isCpdSnapshot = unitName === 'CPD';
  const ustock  = isCpdSnapshot ? cpd     : (unitStock[unitName] || {});
  const ucat    = isCpdSnapshot ? catalog : getUnitCatalog(unitName).catalog;
  const ts      = Date.now();
  // Snapshot: { ts, name, items: {itemId: qty} }
  const snapshot = {
    ts, name: respName, unit: unitName,
    items: {}
  };
  ucat.forEach(i => { snapshot.items[i.id] = ustock[i.id] || 0; });

  // Chave do snapshot: data operacional (ex: "2026-07-29"), em vez do
  // carimbo de hora bruto usado antes. Motivo (29/07, pedido do Eduardo/
  // chefe): assim dá pra localizar/puxar o histórico direto por data, pra
  // poder comparar semana contra semana, mês contra mês, etc. Usa a mesma
  // regra de "dia operacional" (_operationalDateStr — antes das 3h ainda
  // conta como o dia anterior) usada no resto do app, pra ficar consistente
  // com janela de contagem/confirmação. Se já existir uma confirmação geral
  // mais cedo no mesmo dia operacional, esta SUBSTITUI ela — mantém só o
  // snapshot mais recente do dia, que é o que faz sentido pra comparação
  // (não queremos vários registros do mesmo dia, e sim um por dia, "pra
  // sempre" — por isso também não existe mais limite de quantidade de
  // registros; antes só guardava os últimos 30).
  const dataKey = _operationalDateStr(ts);
  const ref = db.ref('dados/pizza_history/' + slug);
  ref.child(dataKey).set(snapshot)
    .then(() => console.log('[Histórico] Snapshot salvo para', unitName, '(' + dataKey + ')'))
    .catch(e => console.warn('[Histórico] Erro ao salvar snapshot:', e));
}

function getGeneralConfirmState(unitName) {
  _checkDailyReset();
  const slug = unitSlug(unitName);
  return catConfirmations[slug] && catConfirmations[slug]._general
    ? catConfirmations[slug]._general : null;
}

function getOpenCountUnits() {
  const abertas = [];
  UNIT_NAMES.forEach(unitName => {
    const slug = unitSlug(unitName);
    const confData = catConfirmations[slug] || {};
    const hasGeneral = !!confData._general;
    const ustock = unitStock[unitName] || {};
    if (dailyRequiredCatsConfirmed(unitName, ustock) && !hasGeneral) {
      const unitCats = getUnitCatalog(unitName).categories;
      const required = getDailyRequiredCategories().filter(cat => unitCats.includes(cat));
      const tsList = required.map(cat => confData[cat] && confData[cat].ts).filter(Boolean);
      const since = tsList.length ? Math.max(...tsList) : null; // momento em que a última obrigatória foi confirmada
      abertas.push({ unitName, since });
    }
  });
  return abertas;
}

function _startZeroCheck() {
  return; // desativado — ver comentário acima
  if (_zeroCheckTimer) return;
  _zeroCheckTimer = setInterval(() => {
    if (!session || isCPD()) return;
    const unitName = session.unit;
    const ustock   = unitStock[unitName] || {};
    const ucat     = getUnitCatalog(unitName);
    const slug     = unitSlug(unitName);
    const now      = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    let changed = false;

    ucat.categories.forEach(cat => {
      const state = getCatConfirmState(unitName, cat, ustock);
      if (state === 'confirmed') return; // confirmada — nunca zera
      // Verificar se algum item desta categoria tem lastModified > 1h atrás
      const catItems = ucat.catalog.filter(i => i.category === cat);
      const hasAnyQty = catItems.some(i => (ustock[i.id] || 0) > 0);
      if (!hasAnyQty) return; // categoria sem dados — nada a zerar
      // Verificar o timestamp da última modificação desta categoria
      const lastMod = catConfirmations[slug] && catConfirmations[slug]['_lastmod_' + cat];
      if (!lastMod) return; // nunca foi modificada — não zera
      if (now - lastMod > ONE_HOUR) {
        // Zerar todos os itens desta categoria
        console.log('[Zeragem] Zerando categoria', cat, 'por inatividade > 1h');
        catItems.forEach(i => {
          if ((ustock[i.id] || 0) > 0) {
            unitStock[unitName][i.id] = 0;
            db.ref('dados/pizza_units/' + slug + '/' + i.id).set(0)
              .catch(e => console.warn('[Zeragem]', e));
            changed = true;
          }
        });
        // Limpar o timestamp para não zerar repetidamente
        delete catConfirmations[slug]['_lastmod_' + cat];
      }
    });

    if (changed) {
      save('pizza_cat_confirms', catConfirmations);
      render();
      toast('\u26A0\uFE0F Categorias não confirmadas zeradas por inatividade (>1h)', 4000);
    }
  }, 60 * 1000); // verificar a cada minuto
}

function markCatModified(unitName, cat) {
  const slug = unitSlug(unitName);
  if (!catConfirmations[slug]) catConfirmations[slug] = {};
  catConfirmations[slug]['_lastmod_' + cat] = Date.now();
  // Se havia confirmação, invalidar
  if (catConfirmations[slug][cat]) {
    delete catConfirmations[slug][cat];
    // Invalidar também a confirmação geral
    delete catConfirmations[slug]._general;
    save('pizza_cat_confirms', catConfirmations);
  }
}

function deconfirmCategory(unitName, cat) {
  const slug = unitSlug(unitName);
  if (catConfirmations[slug] && catConfirmations[slug][cat]) {
    delete catConfirmations[slug][cat];
    // Invalidar confirmação geral também
    if (catConfirmations[slug]._general) delete catConfirmations[slug]._general;
    save('pizza_cat_confirms', catConfirmations);
  }
}

function getUnconfirmedCategoriesWithData(unitName) {
  const ustock = unitStock[unitName] || {};
  const ucat = getUnitCatalog(unitName);
  const pendentes = [];
  ucat.categories.forEach(cat => {
    const state = getCatConfirmState(unitName, cat, ustock);
    if (state === 'confirmed') return;
    const catItems = ucat.catalog.filter(i => i.category === cat);
    const hasAnyQty = catItems.some(i => (ustock[i.id] || 0) > 0);
    if (hasAnyQty) pendentes.push(cat);
  });
  return pendentes;
}

function saveUnitCatalog(unitName, catalogData) {
  const slug = unitSlug(unitName);
  // 1. Atualizar cache em memória
  if (!window._unitCatalogCache) window._unitCatalogCache = {};
  window._unitCatalogCache[slug] = catalogData;
  // 2. Atualizar getUnitCatalog() — os seeds hardcoded ficam desatualizados após edição
  //    A função getUnitCatalog retorna o seed; sobrescrever com o editado via cache
  // 3. Atualizar unitCatalog global se for a unidade logada (para contagem imediata)
  if (typeof session !== 'undefined' && session && unitSlug(session.unit) === slug) {
    unitCatalog = catalogData;
  }
  // 4. Salvar no localStorage
  try { localStorage.setItem('pizza_unit_catalog_' + slug, JSON.stringify(catalogData)); } catch(e) {}
  // 5. Salvar no Firebase
  if (window._fb && window._fb.ready && typeof db !== 'undefined') {
    db.ref('dados/pizza_unit_catalog/' + slug).set(catalogData)
      .catch(e => console.warn('[Firebase] Erro ao salvar catálogo de', unitName, e));
  }
}

function saveLocal(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) {}
}

function unitSlug(unitName) {
  return (unitName || 'unknown')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove acentos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function saveItemAtomic(itemId, qty) {
  if (!window._fb || !window._fb.ready || typeof db === 'undefined') {
    // Offline: salvar localmente e enfileirar
    cpd[itemId] = qty;
    try { localStorage.setItem('pizza_cpd', JSON.stringify(cpd)); } catch(e) {}
    if (!window._fb) window._fb = { ready: false, pendingWrites: [] };
    window._fb.pendingWrites = window._fb.pendingWrites || [];
    window._fb.pendingWrites.push({ type: 'atomic', itemId, qty });
    return;
  }
  // Online: transação atômica no Firebase
  window._fb.localWrite = true;
  clearTimeout(window._fb.localWriteTimer);
  window._fb.localWriteTimer = setTimeout(() => { window._fb.localWrite = false; }, 5000);

  db.ref('dados/pizza_cpd/' + itemId).transaction(currentVal => {
    // currentVal é o valor atual no Firebase — retornar o novo valor
    // Se currentVal for null (item não existe), inicializa com 0 + nova qty
    return qty;
  }, (error, committed) => {
    clearTimeout(window._fb.localWriteTimer);
    if (error) {
      console.error('[Firebase] Transação falhou para', itemId, error);
      window._fb.localWrite = false;
      // Fallback: tentar save() normal
      save('pizza_cpd', cpd);
    } else if (committed) {
      // Transação bem-sucedida — confirmar no localStorage
      try { localStorage.setItem('pizza_cpd', JSON.stringify(cpd)); } catch(e) {}
      window._fb.localWriteTimer = setTimeout(() => { window._fb.localWrite = false; }, 300);
    } else {
      // Transação abortada (currentVal igual ao esperado — sem mudança necessária)
      window._fb.localWrite = false;
    }
  }, false); // false = não ouvir mudanças intermediárias
}

function saveUnit(unitName, stockData) {
  const slug = unitSlug(unitName);
  try { localStorage.setItem('pizza_unit_' + slug, JSON.stringify(stockData)); } catch(e) {}
  if (window._fb && window._fb.ready && typeof db !== 'undefined') {
    window._fb.localWrite = true;
    clearTimeout(window._fb.localWriteTimer);
    window._fb.localWriteTimer = setTimeout(() => { window._fb.localWrite = false; }, 5000);
    db.ref('dados/pizza_units/' + slug).set(stockData)
      .then(() => {
        clearTimeout(window._fb.localWriteTimer);
        window._fb.localWriteTimer = setTimeout(() => { window._fb.localWrite = false; }, 300);
      })
      .catch(e => {
        console.warn('[Firebase] Erro ao salvar unidade ' + unitName + ':', e);
        clearTimeout(window._fb.localWriteTimer);
        window._fb.localWrite = false;
      });
  } else {
    if (!window._fb) window._fb = { ready: false, pendingWrites: [] };
    window._fb.pendingWrites = window._fb.pendingWrites || [];
    window._fb.pendingWrites.push({ type: 'unit', unitName, data: stockData });
  }
}

function save(key, data) {
  // Sempre salva no localStorage (cache local e fallback offline)
  try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) {}

  // Sincroniza com Firebase se for uma chave operacional
  if (FIREBASE_SYNC_KEYS.has(key)) {
    try {
      if (window._fb && window._fb.ready && typeof db !== 'undefined') {
        // Marca write local: impede que o listener re-renderize a tela
        // quando recebe de volta o próprio dado que acabou de enviar
        window._fb.localWrite = true;
        clearTimeout(window._fb.localWriteTimer);
        // 5s de janela para cobrir writes lentos em conexões móveis
        window._fb.localWriteTimer = setTimeout(() => { window._fb.localWrite = false; }, 5000);
        db.ref('dados/' + key).set(data)
          .then(() => {
            // Resetar flag imediatamente após confirmação — não esperar o timer
            clearTimeout(window._fb.localWriteTimer);
            // Pequena janela residual para o listener processar o echo
            window._fb.localWriteTimer = setTimeout(() => { window._fb.localWrite = false; }, 300);
          })
          .catch(e => {
            console.warn('[Firebase] Erro ao salvar ' + key + ':', e);
            // Em caso de erro, liberar o flag para não travar o listener indefinidamente
            clearTimeout(window._fb.localWriteTimer);
            window._fb.localWrite = false;
          });
      } else {
        // Firebase ainda não pronto — enfileira para tentar em seguida
        if (!window._fb) window._fb = { ready: false, pendingWrites: [] };
        window._fb.pendingWrites = window._fb.pendingWrites || [];
        window._fb.pendingWrites.push({ key, data, ts: Date.now() });
      }
    } catch(e) {
      console.warn('[Firebase] save() erro inesperado:', e);
    }
  }
}

function _flushPendingWrites() {
  if (!window._fb || !window._fb.pendingWrites) return;

  // Carregar também writes que sobreviveram a um refresh (persistidos no localStorage)
  try {
    const stored = JSON.parse(localStorage.getItem('_pendingWrites') || '[]');
    if (stored.length > 0) {
      window._fb.pendingWrites = [...stored, ...window._fb.pendingWrites];
      localStorage.removeItem('_pendingWrites');
    }
  } catch(e) {}

  const pending = window._fb.pendingWrites.splice(0);
  if (pending.length === 0) return;
  console.log('[Firebase] Processando', pending.length, 'writes pendentes...');

  // Processar em sequência (FIFO garantido) com retry em caso de erro
  let idx = 0;
  function processNext() {
    if (idx >= pending.length) {
      _updatePendingBadge(0);
      return;
    }
    const item = pending[idx++];
    let promise;
    if (item.type === 'unit') {
      promise = db.ref('dados/pizza_units/' + unitSlug(item.unitName)).set(item.data);
    } else if (item.type === 'atomic') {
      promise = db.ref('dados/pizza_cpd/' + item.itemId).set(item.qty);
    } else {
      promise = db.ref('dados/' + item.key).set(item.data);
    }
    promise
      .then(() => {
        _updatePendingBadge(pending.length - idx);
        processNext();
      })
      .catch(e => {
        console.warn('[Firebase] Erro no write pendente:', e);
        // Reinserir no início da fila para retry
        window._fb.pendingWrites.unshift(item);
        _updatePendingBadge(window._fb.pendingWrites.length);
      });
  }
  _updatePendingBadge(pending.length);
  processNext();
}

function _migrarEstruturaPizzaUnits() {
  if (window._migrandoUnits) return;
  // Não rodar migração offline — dados do cache podem estar incompletos
  if (!window._fb || !window._fb.ready) {
    console.log('[Migração] Adiada — Firebase não está pronto');
    setTimeout(_migrarEstruturaPizzaUnits, 3000);
    return;
  }
  window._migrandoUnits = true;
  db.ref('dados/pizza_units').once('value').then(snap => {
    const val = snap.val();
    if (!val || typeof val !== 'object') {
      window._migrandoUnits = false;
      window._migrationConfirmed = true;
      _gateStep('migrate', 'Dados prontos!');
      return;
    }
    // Verificar se é estrutura antiga: chaves são nomes de unidade (ex: 'Asa Sul')
    const keys = Object.keys(val);
    // Estrutura antiga: chaves são nomes de unidade (ex: 'Asa Sul', 'SIG')
    // Estrutura nova: chaves são slugs (ex: 'asa_sul', 'sig')
    const unitSlugs = UNIT_NAMES.map(n => unitSlug(n));
    const isOldStructure = keys.some(k => UNIT_NAMES.includes(k));
    const isNewStructure = keys.some(k => unitSlugs.includes(k));
    if (!isOldStructure || isNewStructure) {
      // Já está na estrutura nova (ou vazia) — não migrar
      window._migrandoUnits = false;
      window._migrationConfirmed = true;
      _gateStep('migrate', 'Dados prontos!');
      return;
    }
    // Chegou até aqui = detectou nó(s) com nome "cru" (ex: 'Asa Sul') em pizza_units.
    // Isso NÃO deveria mais acontecer em uso normal — os nós antigos foram removidos
    // manualmente em 27/07 após confirmação de que o slug já tinha todos os dados.
    // Por segurança, NUNCA sobrescrevemos um slug que já tem dados: migração automática
    // usando .set() já causou perda de dados em outro ponto do sistema (ver saveUnit),
    // então aqui só copiamos para o slug se ele ainda estiver vazio. Se o slug já tem
    // dados, apenas avisamos no console — não tocamos em nada automaticamente.
    console.warn('[Migração] Nó(s) com nome antigo encontrado(s) em pizza_units:', keys.filter(k => UNIT_NAMES.includes(k)), '— isso não deveria mais ocorrer. Verifique manualmente no Firebase Console.');

    db.ref('.info/connected').once('value').then(connSnap => {
      if (!connSnap.val()) {
        console.warn('[Migração] Adiada — sem conexão. Tentará novamente em 5s');
        window._migrandoUnits = false;
        setTimeout(_migrarEstruturaPizzaUnits, 5000);
        return;
      }
      const unitsAntigas = keys.filter(k => UNIT_NAMES.includes(k));
      // Para cada unidade antiga encontrada, checar se o slug já tem dados antes de escrever
      const checks = unitsAntigas.map(unitName => {
        const slug = unitSlug(unitName);
        return db.ref('dados/pizza_units/' + slug).once('value').then(slugSnap => {
          const slugVal = slugSnap.val();
          const slugTemDados = slugVal && typeof slugVal === 'object' && Object.keys(slugVal).length > 0;
          if (slugTemDados) {
            console.warn(`[Migração] Ignorado: '${unitName}' -> '${slug}' já tem dados (${Object.keys(slugVal).length} itens). Não sobrescrevendo. Se '${unitName}' tiver dados úteis, faça a checagem manual antes de apagar.`);
            return null;
          }
          console.log(`[Migração] '${slug}' está vazio — copiando dados de '${unitName}' para lá.`);
          return db.ref('dados/pizza_units/' + slug).set(val[unitName]);
        });
      });
      Promise.all(checks).then(() => {
        console.log('[Migração] Verificação concluída.', unitsAntigas.length, 'nó(s) antigo(s) checado(s).');
        window._migrandoUnits = false;
        window._migrationConfirmed = true;
        _gateStep('migrate', 'Dados prontos!');
      }).catch(e => {
        console.error('[Migração] Erro:', e);
        window._migrandoUnits = false;
        window._migrationConfirmed = true;
        _gateStep('migrate', 'Pronto (com aviso)');
      });
    }); // .info/connected
  });
}

function resolveUnitCatalog() {
  if (!session || isCPD()) return;
  const info = getUnitCatalog(session.unit);
  unitCatalog = info.catalog;
}

function windowKey() {
  const now = new Date();
  // Entre 0h e 3h, pertence ao dia anterior
  if (now.getHours() < 3) now.setDate(now.getDate() - 1);
  now.setHours(12, 0, 0, 0);
  const iso = now.toISOString().slice(0, 10);
  return iso + '-' + diaOperacional();
}

function setConfirmed(unit, itemId, val) {
  const key = unitSlug(unit);
  if (!countedMap[key]) countedMap[key] = {};
  const wk = windowKey();
  if (!countedMap[key][wk]) countedMap[key][wk] = {};
  if (val) countedMap[key][wk][itemId] = true;
  else delete countedMap[key][wk][itemId];
  save('pizza_counted', countedMap);
}

function isConfirmed(unit, itemId) {
  const key = unitSlug(unit);
  const wk = windowKey();
  return !!(countedMap[key] && countedMap[key][wk] && countedMap[key][wk][itemId]);
}

function pruneCountedMap() {
  Object.keys(countedMap).forEach(unit => {
    const keys = Object.keys(countedMap[unit]).sort();
    if (keys.length > 4) {
      keys.slice(0, keys.length - 4).forEach(k => delete countedMap[unit][k]);
    }
  });
}

function isMobile() { return window.innerWidth < 600; }

function isCPD()  { return session && session.unit === 'cpd'; }

function allowedViews() {
  if (!session) return [];
  if (isCPD()) return ['cpd','units','envios-dia','historico-contagens','validade','producao','catalogo'];
  return ['units','validade']; // Unidades: apenas o Painel de Contagem
}

function defaultView() {
  return isCPD() ? 'cpd' : 'units';
}

function diaOperacional() {
  const now = new Date();
  let d = now.getDay();
  if (now.getHours() < 3) d = (d + 6) % 7;
  return d;
}

function _operationalDateStr(ts) {
  const d = new Date(ts);
  if (d.getHours() < 3) d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function getCategoryStaleness(unitName, cat) {
  const slug = unitSlug(unitName);
  const conf = catConfirmations[slug] && catConfirmations[slug][cat];
  if (!conf) return { days: null, never: true };

  const shipDate = nextEnviarDate();
  const windowStart = new Date(shipDate);
  windowStart.setDate(windowStart.getDate() - 1);
  windowStart.setHours(18, 0, 0, 0);

  if (conf.ts >= windowStart.getTime()) return null; // dentro da janela válida do envio

  const todayStr = _operationalDateStr(Date.now());
  const confStr  = _operationalDateStr(conf.ts);
  const days = Math.max(1, Math.round((new Date(todayStr) - new Date(confStr)) / 86400000));
  return { days, never: false };
}

function dentroDoHorario() {
  return true; // Trava de horário removida
}

function categoriaLiberada(cat) {
  if (isCPD()) return true;
  const cats = session ? getUnitCatalog(session.unit).categories : UNIT_CATEGORIES;
  return cats.includes(cat);
}

function proximaJanela(cat) {
  const hoje = diaOperacional();
  for (let i = 0; i <= 7; i++) {
    const d = (hoje + i) % 7;
    const allowed = CONTAGEM_JANELAS[d];
    if (allowed && (allowed.includes('ALL') || allowed.includes(cat))) {
      if (i === 0 && !dentroDoHorario()) return DIAS_SEMANA[d] + ' a partir das 15h';
      if (i === 0) return 'hoje';
      return DIAS_SEMANA[d] + ' a partir das 15h';
    }
  }
  return 'a definir';
}

async function _sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function logout() {
  // Gate de saída: se a própria unidade tem as categorias obrigatórias do dia
  // prontas mas a Confirmação Geral ainda não foi feita, não deixa sair sem
  // decidir. Duas opções, nenhuma terceira: finalizar agora ou descartar.
  if (session && !isCPD()) {
    const ustock = unitStock[session.unit] || {};
    if (dailyRequiredCatsConfirmed(session.unit, ustock) && !getGeneralConfirmState(session.unit)) {
      _openExitDecisionModal(session.unit);
      return;
    }
    // Gate mais leve: categorias que NÃO são obrigatórias do dia (ou já
    // passaram da Confirmação Geral) também podem ter número digitado sem
    // confirmar — avisa antes de sair para não virar zero fantasma no relatório.
    const pendentes = getUnconfirmedCategoriesWithData(session.unit);
    if (pendentes.length > 0) {
      const lista = formatCategoryList(pendentes);
      if (!confirm(`Atenção: ${lista} tem contagem digitada mas não confirmada (sem clicar em \u2713). Se sair agora, esses números podem ser lidos como "não contado" no relatório. Sair mesmo assim?`)) return;
    }
  }
  if (!confirm(`Sair da conta de ${session?.name || 'usu\u00E1rio'}?`)) return;
  _doLogout();
}

function qpSalvarHistorico(dayIdx) {
  if (!window._fb || !window._fb.ready || typeof db === 'undefined') return;
  const today = new Date();
  const diff  = dayIdx - ((new Date().getDay() + 6) % 7);
  const d     = new Date(today); d.setDate(d.getDate() + diff);
  const isoDate = d.toISOString().slice(0,10);
  const snapshot = { date: isoDate, day: QP_DIAS[dayIdx], areas: {} };
  QP_AREAS.forEach(area => {
    const items = FT_LIBRARY.filter(f => f.area === area);
    snapshot.areas[area] = items.map(ft => ({
      id: ft.id, nome: ft.nome,
      lotes: qpGet(`qty_${dayIdx}_${ft.id}`, 0),
      liberado: qpGet(`lib_${dayIdx}_${ft.id}`, false),
      obs: qpGet(`obs_${dayIdx}_${ft.id}`, ''),
    })).filter(i => i.lotes > 0 || i.liberado);
  });
  snapshot.masseiro = {
    mucarela: qpGet(`prod_${dayIdx}_Muçarela`, 0),
    biga:     qpGet(`prod_${dayIdx}_Biga`, 0),
    massa:    qpGet(`prod_${dayIdx}_Massa`, 0),
  };
  db.ref('dados/pizza_production_log/' + isoDate).set(snapshot)
    .catch(e => console.warn('[Quadro] Erro ao salvar histórico:', e));
}

// Gera o próximo código de item ao adicionar algo novo pelo catálogo (botão
// "+ Adicionar item"), seguindo o MESMO padrão letra(s)+número que o resto
// do catálogo já usa (ex: rf01, es02, ub03) — em vez do carimbo de hora bruto
// usado antes (Date.now().toString()). Adicionado 29/07: o chefe do Eduardo
// achou 103 chaves órfãs no estoque do CPD, e 22 delas eram exatamente
// carimbos de hora — item novo cadastrado assim, depois removido/recriado
// do catálogo, e o número que ele tinha em estoque ficou "preso" numa chave
// sem dono, porque timestamp nunca colide com nada nem segue um padrão
// reconhecível. Essa função evita que isso continue acontecendo daqui pra
// frente (não mexe nos órfãos que já existem — isso é uma limpeza à parte).
//
// Estratégia: olha os itens JÁ CADASTRADOS na mesma categoria pra descobrir
// qual prefixo essa categoria usa (ex: 'rf' pra Refrigerados), acha o maior
// número já usado com esse prefixo em TODO o catálogo (evita colisão mesmo
// no caso raro de dois categorias compartilharem prefixo, como acontece
// hoje com 'us' em Delivery/Salão da Asa Sul) e devolve prefixo+número+1,
// com 2 dígitos. Se a categoria estiver vazia (sem nenhum item ainda),
// usa as duas primeiras letras do nome da categoria como prefixo. Em
// qualquer cenário, confirma que o id gerado não colide com nenhum outro
// antes de devolver — nunca decide "no escuro".
function _proximoIdCatalogo(catalogArr, category) {
  const idsExistentes = new Set((catalogArr || []).map(i => i && i.id).filter(Boolean));
  const itemDaCategoria = (catalogArr || []).find(i => i && i.category === category && /^[a-z]+\d+$/i.test(i.id || ''));
  let prefixo;
  if (itemDaCategoria) {
    prefixo = itemDaCategoria.id.match(/^([a-z]+)\d+$/i)[1].toLowerCase();
  } else {
    const base = (category || 'nv').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '').slice(0, 2) || 'nv';
    prefixo = base;
  }
  let maiorNum = 0;
  (catalogArr || []).forEach(i => {
    const m = i && i.id && i.id.match(new RegExp('^' + prefixo + '(\\d+)$', 'i'));
    if (m) maiorNum = Math.max(maiorNum, parseInt(m[1], 10));
  });
  let novoId;
  let tentativa = maiorNum + 1;
  do {
    novoId = prefixo + String(tentativa).padStart(2, '0');
    tentativa++;
  } while (idsExistentes.has(novoId));
  return novoId;
}
