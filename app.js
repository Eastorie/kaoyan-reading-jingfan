(function () {
  "use strict";

  let BANK = window.KAOYAN_JINGFAN_BANK || [];
  let BANK_MANIFEST = [];
  const BANK_CHUNKS = {};
  let isChunkLoading = false;

  const STORAGE_KEY_RECORDS = "kaoyan_jingfan_records_v1";
  const STORAGE_KEY_NOTEBOOK = "kaoyan_jingfan_notebook_v1";
  const STORAGE_KEY_UI = "kaoyan_jingfan_ui_v1";
  const STORAGE_KEY_QANSWERS = "kaoyan_jingfan_qanswers_v1";

  let state = {
    exam: "英语（二）", // '英语（二）' | '英语（一）'
    year: 2015,
    textId: 1,
    activeTab: "practice", // 'practice' | 'overview' | 'questions' | 'notebook'
    autoCollectWeak: true,
    showReport: false,
    nbFilter: "all", // 'all' | 'vocab' | 'pattern' | 'unmastered'
    nbSearch: "",
    qAnswers: {}, // { '2015-T1-Q21': 'A' }
    records: {}, // { '2015-T1-P1-S1': { userZh, submitted, evalResult, ts } }
    notebook: [], // [{ id, kind: 'vocab'|'pattern', term, meaning, context_zh, source, reason, en, zh, user_zh, note, mastered }]
  };

  // Seamless historical data migration helper
  // Ensures compatibility across version upgrades without losing existing user answers
  function migrateHistoricalKeys() {
    let dirty = false;

    // 1. Migrate records: from '2015-T1-P1-S1' to '2015-E2-T1-P1-S1'
    if (state.records && typeof state.records === "object") {
      const oldKeys = Object.keys(state.records);
      oldKeys.forEach((k) => {
        const m = k.match(/^(\d{4})-(T\d+-P\d+-S\d+)$/);
        if (m) {
          const newK = `${m[1]}-E2-${m[2]}`;
          if (!state.records[newK]) {
            state.records[newK] = state.records[k];
          }
          dirty = true;
        }
      });
    }

    // 2. Migrate qAnswers: from '2015-T1-Q21' to '2015-E2-T1-Q21'
    if (state.qAnswers && typeof state.qAnswers === "object") {
      const oldQKeys = Object.keys(state.qAnswers);
      oldQKeys.forEach((k) => {
        const m = k.match(/^(\d{4})-(T\d+-Q\d+)$/);
        if (m) {
          const newK = `${m[1]}-E2-${m[2]}`;
          if (!state.qAnswers[newK]) {
            state.qAnswers[newK] = state.qAnswers[k];
          }
          dirty = true;
        }
      });
    }

    // 3. Migrate notebook item ids and sentIds
    if (Array.isArray(state.notebook)) {
      state.notebook.forEach((item) => {
        if (item.sentId) {
          const m = item.sentId.match(/^(\d{4})-(T\d+-P\d+-S\d+)$/);
          if (m) {
            item.sentId = `${m[1]}-E2-${m[2]}`;
            dirty = true;
          }
        }
        if (item.id && !item.id.includes("-E1-") && !item.id.includes("-E2-")) {
          item.id = item.id.replace(
            /(::)(\d{4})-(T\d+-P\d+-S\d+)$/,
            `$1$2-E2-$3`
          );
          dirty = true;
        }
      });
    }

    if (dirty) {
      saveRecords();
      saveQAnswers();
      saveNotebook();
    }
  }

  function loadStorage() {
    try {
      const savedRecords = localStorage.getItem(STORAGE_KEY_RECORDS);
      if (savedRecords) state.records = JSON.parse(savedRecords);
      const savedNb = localStorage.getItem(STORAGE_KEY_NOTEBOOK);
      if (savedNb) state.notebook = JSON.parse(savedNb);
      const savedQa = localStorage.getItem(STORAGE_KEY_QANSWERS);
      if (savedQa) state.qAnswers = JSON.parse(savedQa);
      const savedUi = localStorage.getItem(STORAGE_KEY_UI);
      if (savedUi) {
        const ui = JSON.parse(savedUi);
        if (ui.exam) state.exam = ui.exam;
        if (ui.year) state.year = ui.year;
        if (ui.textId) state.textId = ui.textId;
        if (typeof ui.autoCollectWeak === "boolean") state.autoCollectWeak = ui.autoCollectWeak;
      }
      migrateHistoricalKeys();
    } catch (e) {
      console.warn("Failed to load state from localStorage:", e);
    }
  }

  function saveRecords() {
    try {
      localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(state.records));
    } catch (e) {}
  }

  function saveQAnswers() {
    try {
      localStorage.setItem(STORAGE_KEY_QANSWERS, JSON.stringify(state.qAnswers));
    } catch (e) {}
  }

  function saveNotebook() {
    try {
      localStorage.setItem(STORAGE_KEY_NOTEBOOK, JSON.stringify(state.notebook));
    } catch (e) {}
    updateNotebookBadges();
  }

  function saveUi() {
    try {
      localStorage.setItem(
        STORAGE_KEY_UI,
        JSON.stringify({
          exam: state.exam,
          year: state.year,
          textId: state.textId,
          autoCollectWeak: state.autoCollectWeak,
        })
      );
    } catch (e) {}
  }

  function showToast(msg) {
    const el = document.getElementById("toastMsg");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function escHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getExamSlug(exam) {
    return exam && exam.includes("一") ? "e1" : "e2";
  }

  function getChunkKey(exam, year) {
    return `${getExamSlug(exam)}_${year}`;
  }

  function getAvailableYears() {
    if (BANK_MANIFEST && BANK_MANIFEST.length > 0) {
      return BANK_MANIFEST.filter((y) => y.exam === state.exam);
    }
    if (BANK && BANK.length > 0) {
      return BANK.filter((y) => y.exam === state.exam);
    }
    return [];
  }

  function renderWorkspaceLoading() {
    const workspace = document.getElementById("workspaceArea");
    if (!workspace) return;
    workspace.innerHTML = `
      <div class="card" style="text-align:center;padding:56px 20px;">
        <div class="chunk-spinner" style="width:40px;height:40px;border:3px solid var(--border-light);border-top-color:var(--brand-navy);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 16px;"></div>
        <h3 style="font-size:16px;color:var(--brand-navy);margin-bottom:6px;">正在极速载入 ${escHtml(state.exam)} ${state.year} 年全真精翻题库...</h3>
        <p style="font-size:13px;color:var(--ink-secondary);">按需动态秒开 · 仅消耗约 30KB 流量</p>
      </div>
    `;
  }

  function renderWorkspaceError(msg) {
    const workspace = document.getElementById("workspaceArea");
    if (!workspace) return;
    workspace.innerHTML = `
      <div class="card" style="text-align:center;padding:56px 20px;">
        <h3 style="font-size:16px;color:var(--accent-red);margin-bottom:6px;">题库数据加载失败</h3>
        <p style="font-size:13.5px;color:var(--ink-secondary);max-width:480px;margin:0 auto 16px;">${escHtml(msg)}</p>
        <button class="btn btn-primary" onclick="location.reload()">重新载入页面</button>
      </div>
    `;
  }

  async function loadYearChunk(year = state.year, exam = state.exam) {
    const key = getChunkKey(exam, year);
    if (BANK_CHUNKS[key]) return BANK_CHUNKS[key];

    const inBank = BANK.find((y) => Number(y.year) === Number(year) && y.exam === exam);
    if (inBank) {
      BANK_CHUNKS[key] = inBank;
      return inBank;
    }

    try {
      isChunkLoading = true;
      renderSidebar();
      renderWorkspaceLoading();
      const res = await fetch(`data/chunks/${key}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      BANK_CHUNKS[key] = data;
      isChunkLoading = false;
      renderAll();
      return data;
    } catch (err) {
      console.warn(`Failed to fetch chunk ${key}:`, err);
      isChunkLoading = false;
      if (BANK.length > 0) {
        renderAll();
      } else {
        renderWorkspaceError(`加载 ${exam} ${year} 年真题失败，请检查网络连接或本地静态服务器。`);
      }
      return null;
    }
  }

  function getYearObj(year = state.year, exam = state.exam) {
    const key = getChunkKey(exam, year);
    if (BANK_CHUNKS[key]) {
      return BANK_CHUNKS[key];
    }
    let found = BANK.find((y) => Number(y.year) === Number(year) && (!exam || y.exam === exam));
    if (found) {
      BANK_CHUNKS[key] = found;
      return found;
    }
    const chunkKeys = Object.keys(BANK_CHUNKS);
    if (chunkKeys.length > 0) {
      return BANK_CHUNKS[chunkKeys[0]];
    }
    return BANK[0] || null;
  }

  function getCurrentPassage() {
    const yObj = getYearObj(state.year);
    if (!yObj) return null;
    return yObj.texts.find((t) => Number(t.id) === Number(state.textId)) || yObj.texts[0];
  }

  function getPassageSentences(passage) {
    const list = [];
    if (!passage) return list;
    passage.paragraphs.forEach((p, pIdx) => {
      p.sentences.forEach((s, sIdx) => {
        list.push({
          ...s,
          pIdx: pIdx + 1,
          sIdx: sIdx + 1,
          paraSummary: p.summary,
        });
      });
    });
    return list;
  }

  // =========================================================================
  // Intelligent Translation Evaluator & Diagnostic Engine
  // =========================================================================
  const ZH_STOP_CHARS = new Set("的了着过地得和与及或而但又也还就都更最很太只把被向往从在当比跟同对关于对于之其乃则若虽即便将个位名种项条篇，。、；：？！“”‘’（）()《》—…·,.;:?!\"'- ");

  function cleanZhChars(str) {
    const out = [];
    for (const ch of String(str || "")) {
      if (/[\u4e00-\u9fa5A-Za-z0-9]/.test(ch) && !ZH_STOP_CHARS.has(ch)) {
        out.push(ch);
      }
    }
    return out;
  }

  function charDiceSimilarity(a, b) {
    const ca = cleanZhChars(a);
    const cb = cleanZhChars(b);
    if (!ca.length || !cb.length) return 0;
    const freqB = {};
    cb.forEach((c) => (freqB[c] = (freqB[c] || 0) + 1));
    let overlap = 0;
    ca.forEach((c) => {
      if (freqB[c] > 0) {
        overlap++;
        freqB[c]--;
      }
    });
    const recall = overlap / cb.length;
    const dice = (2 * overlap) / (ca.length + cb.length);
    return recall * 0.65 + dice * 0.35;
  }

  function matchKeywordList(userZh, kws, fallbackZh) {
    const cleanUser = String(userZh || "").trim();
    if (!cleanUser) return { hit: false, ratio: 0 };

    if (Array.isArray(kws) && kws.length > 0) {
      let matchedCount = 0;
      for (const kw of kws) {
        if (kw && cleanUser.includes(kw)) {
          matchedCount++;
        }
      }
      if (matchedCount > 0) {
        return { hit: true, ratio: Math.min(1, 0.75 + matchedCount * 0.12) };
      }
    }

    // Fallback character overlap against gloss
    const sim = charDiceSimilarity(cleanUser, fallbackZh || "");
    return { hit: sim >= 0.42, ratio: sim };
  }

  function evaluateSentence(sent, userZh) {
    const rawInput = String(userZh || "").trim();
    if (!rawInput) {
      return {
        score: 0,
        chunkScore: 0,
        vocabScore: 0,
        patternScore: 0,
        fluencyScore: 0,
        chunkResults: (sent.chunks || []).map((c) => ({ en: c[0], zh: c[1], hit: false, ratio: 0 })),
        vocabResults: (sent.vocab || []).map((v) => ({ ...v, hit: false, status: "未译出" })),
        patternResults: (sent.patterns || []).map((p) => ({ ...p, hit: false, status: "未译出" })),
        feedback: "未填写译文，被判定为整句未译出，本句核心词汇与句型已标记为待重点攻克。",
      };
    }

    // 1. Evaluate semantic chunks
    const chunks = sent.chunks || [];
    const chunkResults = chunks.map((c, idx) => {
      const kws = (sent.chunk_kws && sent.chunk_kws[idx]) || [];
      const m = matchKeywordList(rawInput, kws, c[1]);
      return {
        en: c[0],
        zh: c[1],
        hit: m.hit,
        ratio: m.ratio,
      };
    });
    const chunkAvg =
      chunkResults.length > 0
        ? chunkResults.reduce((acc, r) => acc + (r.hit ? Math.max(0.88, r.ratio) : r.ratio * 0.5), 0) /
          chunkResults.length
        : 0.8;

    // 2. Evaluate core vocabulary items
    const vocabList = sent.vocab || [];
    const vocabResults = vocabList.map((v) => {
      const m = matchKeywordList(rawInput, v.kws, v.context_zh || v.meaning);
      return {
        ...v,
        hit: m.hit,
        status: m.hit ? "已掌握" : m.ratio > 0.18 ? "翻译偏差" : "未译出",
      };
    });
    const vocabAvg =
      vocabResults.length > 0
        ? vocabResults.reduce((acc, v) => acc + (v.hit ? 1 : 0.25), 0) / vocabResults.length
        : chunkAvg;

    // 3. Evaluate sentence patterns
    const patternList = sent.patterns || [];
    const patternResults = patternList.map((p) => {
      const m = matchKeywordList(rawInput, p.kws, p.zh_anchor);
      return {
        ...p,
        hit: m.hit,
        status: m.hit ? "结构准确" : m.ratio > 0.2 ? "句型偏差" : "句型漏译",
      };
    });
    const patternAvg =
      patternResults.length > 0
        ? patternResults.reduce((acc, p) => acc + (p.hit ? 1 : 0.3), 0) / patternResults.length
        : chunkAvg;

    // 4. Overall character similarity with reference translation
    const overallSim = charDiceSimilarity(rawInput, sent.zh);

    // Weighted total score (0-100)
    let rawScore = Math.round((chunkAvg * 0.45 + vocabAvg * 0.25 + patternAvg * 0.15 + overallSim * 0.15) * 100);
    if (rawInput === sent.zh.trim()) rawScore = 100;
    const score = Math.max(5, Math.min(100, rawScore));

    const missedVocab = vocabResults.filter((v) => !v.hit);
    const missedPatterns = patternResults.filter((p) => !p.hit);

    let feedback = "";
    if (score >= 88) {
      feedback = "译文准确流畅！核心语块与句法逻辑还原到位。";
    } else if (score >= 70) {
      feedback = `主干意思基本正确，建议核对${missedVocab.length ? `【${missedVocab.map((v) => v.word).join(" / ")}】的语境词义` : "局部修饰语序"}${missedPatterns.length ? `及【${missedPatterns[0].name}】的衔接` : ""}。`;
    } else {
      feedback = `存在明显漏译或句法错位：重点关注${missedVocab.slice(0, 3).map((v) => `【${v.word}】`).join("、") || "核心谓语"}以及${missedPatterns.map((p) => `【${p.name}】`).join("、") || "从句切分"}。`;
    }

    return {
      score,
      chunkScore: Math.round(chunkAvg * 100),
      vocabScore: Math.round(vocabAvg * 100),
      patternScore: Math.round(patternAvg * 100),
      fluencyScore: Math.round(overallSim * 100),
      chunkResults,
      vocabResults,
      patternResults,
      feedback,
    };
  }

  // =========================================================================
  // Notebook Management
  // =========================================================================
  function makeNotebookId(kind, term, sentId) {
    return `${kind}::${String(term).toLowerCase().trim()}::${sentId}`;
  }

  function isInNotebook(kind, term, sentId) {
    const id = makeNotebookId(kind, term, sentId);
    return state.notebook.some((item) => item.id === id);
  }

  function upsertNotebookItem(entry, silent = false) {
    const idx = state.notebook.findIndex((x) => x.id === entry.id);
    if (idx >= 0) {
      state.notebook[idx] = { ...state.notebook[idx], ...entry };
      saveNotebook();
      if (!silent) showToast(`已更新单词本记录：${entry.term}`);
      return false;
    } else {
      state.notebook.unshift({
        ...entry,
        mastered: false,
        addedAt: Date.now(),
      });
      saveNotebook();
      if (!silent) showToast(`已加入单词本：${entry.term}`);
      return true;
    }
  }

  function removeNotebookItem(id, silent = false) {
    const idx = state.notebook.findIndex((x) => x.id === id);
    if (idx >= 0) {
      const removed = state.notebook.splice(idx, 1)[0];
      saveNotebook();
      if (!silent) showToast(`已从单词本移除：${removed.term}`);
      return true;
    }
    return false;
  }

  function toggleNotebookItem(entry, silent = false) {
    if (isInNotebook(entry.kind, entry.term, entry.sentId)) {
      removeNotebookItem(entry.id, silent);
      return false;
    } else {
      upsertNotebookItem(entry, silent);
      return true;
    }
  }

  function collectSentenceWeaknesses(sent, userZh, evalRes, silent = true) {
    let addedCount = 0;
    const sourceLabel = `${state.year} Text ${state.textId} · ${sent.code}`;

    // Only auto-collect when the sentence translation has actual mistakes or omissions (score < 85)
    // If user's translation is already good (score >= 85), do not spam notebook with items that might have been phrased differently
    if (evalRes.score >= 85) return addedCount;

    (evalRes.vocabResults || []).forEach((v) => {
      if (!v.hit) {
        const id = makeNotebookId("vocab", v.word, sent.id);
        const created = upsertNotebookItem(
          {
            id,
            sentId: sent.id,
            kind: "vocab",
            term: v.word,
            meaning: v.meaning,
            context_zh: v.context_zh || "",
            source: sourceLabel,
            reason: v.status || "未译出",
            en: sent.en,
            zh: sent.zh,
            user_zh: userZh,
            note: sent.note || "",
          },
          true
        );
        if (created) addedCount++;
      }
    });

    (evalRes.patternResults || []).forEach((p) => {
      if (!p.hit) {
        const id = makeNotebookId("pattern", p.name, sent.id);
        const created = upsertNotebookItem(
          {
            id,
            sentId: sent.id,
            kind: "pattern",
            term: p.name,
            meaning: `${p.en_anchor} → ${p.zh_anchor}`,
            context_zh: p.zh_anchor || "",
            source: sourceLabel,
            reason: p.status || "句型偏差",
            en: sent.en,
            zh: sent.zh,
            user_zh: userZh,
            note: `${p.note || ""}（点拨：${p.advice || ""}）`,
          },
          true
        );
        if (created) addedCount++;
      }
    });

    if (!silent && addedCount > 0) {
      showToast(`已将 ${addedCount} 项未译出/偏差词句整理至单词本`);
    }
    return addedCount;
  }

  function updateNotebookBadges() {
    const count = state.notebook.length;
    const b1 = document.getElementById("nbCountBadge");
    const b2 = document.getElementById("mobNbCount");
    if (b1) b1.textContent = count;
    if (b2) b2.textContent = count;
  }

  // =========================================================================
  // Passage Report Calculation
  // =========================================================================
  function computePassageReport(passage) {
    const sents = getPassageSentences(passage);
    const total = sents.length;
    let submittedCount = 0;
    let sumScore = 0;
    let sumChunk = 0;
    let sumVocab = 0;
    let sumPattern = 0;

    const missedVocabAll = [];
    const missedPatternAll = [];
    const perSentence = [];

    sents.forEach((s) => {
      const rec = state.records[s.id];
      const userZh = rec ? rec.userZh : "";
      const evalRes = rec && rec.evalResult ? rec.evalResult : evaluateSentence(s, userZh);
      if (rec && rec.submitted) submittedCount++;

      sumScore += evalRes.score;
      sumChunk += evalRes.chunkScore;
      sumVocab += evalRes.vocabScore;
      sumPattern += evalRes.patternScore;

      perSentence.push({
        sent: s,
        userZh,
        submitted: Boolean(rec && rec.submitted),
        evalRes,
      });

      (evalRes.vocabResults || []).forEach((v) => {
        if (!v.hit) {
          missedVocabAll.push({
            sent: s,
            userZh,
            vocab: v,
          });
        }
      });

      (evalRes.patternResults || []).forEach((p) => {
        if (!p.hit) {
          missedPatternAll.push({
            sent: s,
            userZh,
            pattern: p,
          });
        }
      });
    });

    const avgScore = total ? Math.round(sumScore / total) : 0;
    const avgChunk = total ? Math.round(sumChunk / total) : 0;
    const avgVocab = total ? Math.round(sumVocab / total) : 0;
    const avgPattern = total ? Math.round(sumPattern / total) : 0;

    let grade = "A 级 · 扎实精准";
    let summaryAdvice = "你对本篇的核心词汇和长难句切分掌握得非常扎实！建议结合下方错题微调语序表达。";
    if (avgScore >= 88) {
      grade = "S 级 · 卓越精翻";
      summaryAdvice = "翻译准确度极高！无论是核心词块对位还是从句逻辑衔接都达到了考研高分水准。";
    } else if (avgScore >= 72) {
      grade = "A 级 · 良好达标";
      summaryAdvice = "主干把握准确，但在部分熟词僻义和插入语/后置定语从句的语序转换上仍有提分空间。";
    } else if (avgScore >= 55) {
      grade = "B 级 · 基础尚可";
      summaryAdvice = "能够抓取部分句子大意，但存在较多核心短语漏译及长难句结构错位，请重点复盘下方整理的单词本。";
    } else {
      grade = "C 级 · 急需强化";
      summaryAdvice = "本篇未译出或偏差的词块与句型较多，系统已将薄弱点汇总至下方列表及单词本，建议逐句对照蓝字译文朗读复盘。";
    }

    return {
      total,
      submittedCount,
      avgScore,
      avgChunk,
      avgVocab,
      avgPattern,
      grade,
      summaryAdvice,
      missedVocabAll,
      missedPatternAll,
      perSentence,
    };
  }

  // =========================================================================
  // Rendering Functions
  // =========================================================================
  function renderHeaderControls() {
    const examSel = document.getElementById("examSelect");
    if (examSel) {
      examSel.value = state.exam;
      if (!examSel._bound) {
        examSel._bound = true;
        examSel.addEventListener("change", (e) => {
          state.exam = e.target.value;
          refreshYearOptions();
          state.showReport = false;
          saveUi();
          loadYearChunk(state.year, state.exam).then(() => renderAll());
        });
      }
    }

    function refreshYearOptions() {
      const yearSel = document.getElementById("yearSelect");
      if (!yearSel) return;
      const filteredYears = getAvailableYears();
      yearSel.innerHTML = "";
      filteredYears.forEach((y) => {
        const opt = document.createElement("option");
        opt.value = y.year;
        opt.textContent = `${y.year} 年`;
        yearSel.appendChild(opt);
      });
      const exists = filteredYears.some((y) => Number(y.year) === Number(state.year));
      if (!exists && filteredYears.length > 0) {
        state.year = Number(filteredYears[0].year);
      }
      yearSel.value = state.year;
    }

    const yearSel = document.getElementById("yearSelect");
    if (yearSel) {
      if (!yearSel.options.length) {
        refreshYearOptions();
      }
      if (!yearSel._bound) {
        yearSel._bound = true;
        yearSel.addEventListener("change", (e) => {
          state.year = Number(e.target.value);
          state.showReport = false;
          saveUi();
          loadYearChunk(state.year, state.exam).then(() => renderAll());
        });
      }
      yearSel.value = state.year;
    }

    const pillsWrap = document.getElementById("textPills");
    if (pillsWrap) {
      pillsWrap.innerHTML = [1, 2, 3, 4]
        .map(
          (tid) => `
        <button class="text-pill ${Number(state.textId) === tid ? "active" : ""}" data-tid="${tid}">
          Text ${tid}
        </button>`
        )
        .join("");
      pillsWrap.querySelectorAll(".text-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.textId = Number(btn.dataset.tid);
          state.showReport = false;
          saveUi();
          renderAll();
        });
      });
    }

    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === state.activeTab);
    });
    updateNotebookBadges();
  }

  function renderSidebar() {
    const passage = getCurrentPassage();
    if (!passage) return;
    const sents = getPassageSentences(passage);
    const doneSents = sents.filter((s) => state.records[s.id] && state.records[s.id].submitted);
    const pct = sents.length ? Math.round((doneSents.length / sents.length) * 100) : 0;

    const metaCard = document.getElementById("passageMetaCard");
    if (metaCard) {
      metaCard.innerHTML = `
        <span class="passage-meta-tag">${state.year} 英语（二） · Text ${passage.id}</span>
        <h2 class="passage-title">${escHtml(passage.title)}</h2>
        <div class="meta-list">
          <div class="meta-item"><strong>题材体裁：</strong>${escHtml(passage.genre)}</div>
          <div class="meta-item"><strong>核心主题词：</strong>${Array.isArray(passage.keywords) ? passage.keywords.map(escHtml).join(" / ") : escHtml(passage.keywords || "阅读重点语篇")}</div>
          <div class="meta-item"><strong>行文脉络：</strong>${escHtml(passage.logic)}</div>
        </div>
      `;
    }

    const progCard = document.getElementById("progressCard");
    if (progCard) {
      progCard.innerHTML = `
        <div class="progress-header">
          <span>本篇精翻进度</span>
          <span style="color:var(--brand-navy);">${doneSents.length} / ${sents.length} 句 (${pct}%)</span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="sent-grid-nav">
          ${sents
            .map((s) => {
              const rec = state.records[s.id];
              let cls = "";
              if (rec && rec.submitted && rec.evalResult) {
                const sc = rec.evalResult.score;
                cls = sc >= 85 ? "done-high" : sc >= 65 ? "done-mid" : "done-low";
              }
              return `<button class="sent-dot ${cls}" data-jump="${s.id}" title="跳转至 ${s.code}">${s.code}</button>`;
            })
            .join("")}
        </div>
        <div class="side-actions">
          <button class="btn btn-primary" id="btnFinishPassage">
            整篇交卷打分与诊断报告
          </button>
          <button class="btn btn-soft" id="btnDemoFill">
            填入模拟作答（快速体验批改）
          </button>
          <button class="btn btn-outline" id="btnResetPassage">
            清空本篇作答记录
          </button>
        </div>
      `;

      progCard.querySelectorAll("[data-jump]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (state.activeTab !== "practice") {
            state.activeTab = "practice";
            renderAll();
          }
          const target = document.getElementById(`card-${btn.dataset.jump}`);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      });

      const btnFinish = document.getElementById("btnFinishPassage");
      if (btnFinish) {
        btnFinish.addEventListener("click", () => {
          handleFinishWholePassage();
        });
      }

      const btnDemo = document.getElementById("btnDemoFill");
      if (btnDemo) {
        btnDemo.addEventListener("click", () => {
          handleFillDemoTranslations();
        });
      }

      const btnReset = document.getElementById("btnResetPassage");
      if (btnReset) {
        btnReset.addEventListener("click", () => {
          sents.forEach((s) => delete state.records[s.id]);
          state.showReport = false;
          saveRecords();
          renderAll();
          showToast("已清空本篇作答记录，可重新开始逐句精翻");
        });
      }
    }
  }

  function handleFinishWholePassage() {
    const passage = getCurrentPassage();
    if (!passage) return;
    const sents = getPassageSentences(passage);
    let newlyAdded = 0;

    sents.forEach((s) => {
      const existing = state.records[s.id] || { userZh: "", submitted: false };
      // Read live textarea value if present on DOM
      const ta = document.getElementById(`input-${s.id}`);
      const userZh = ta ? ta.value.trim() : existing.userZh || "";
      const evalRes = evaluateSentence(s, userZh);
      state.records[s.id] = {
        userZh,
        submitted: true,
        evalResult: evalRes,
        ts: Date.now(),
      };
      if (state.autoCollectWeak) {
        newlyAdded += collectSentenceWeaknesses(s, userZh, evalRes, true);
      }
    });

    state.activeTab = "practice";
    state.showReport = true;
    saveRecords();
    renderAll();

    const repEl = document.getElementById("wholePassageReport");
    if (repEl) repEl.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(`已完成整篇批改打分！${newlyAdded > 0 ? `自动收录 ${newlyAdded} 条薄弱词句入单词本` : "诊断报告已生成"}`);
  }

  function handleFillDemoTranslations() {
    const passage = getCurrentPassage();
    if (!passage) return;
    const sents = getPassageSentences(passage);
    let newlyAdded = 0;

    sents.forEach((s, idx) => {
      let simText = s.zh;
      // Intentionally simulate realistic partial omissions on every 2nd/3rd sentence so scoring & notebook collection are realistically demonstrated
      if (idx % 3 === 0 && s.chunks.length >= 2) {
        simText = s.chunks
          .filter((_, cIdx) => cIdx !== 1)
          .map((c) => c[1])
          .join("，");
      } else if (idx % 4 === 1 && s.chunks.length >= 2) {
        simText = s.chunks.slice(0, -1).map((c) => c[1]).join("，") + "。";
      }
      const evalRes = evaluateSentence(s, simText);
      state.records[s.id] = {
        userZh: simText,
        submitted: true,
        evalResult: evalRes,
        ts: Date.now(),
      };
      if (state.autoCollectWeak) {
        newlyAdded += collectSentenceWeaknesses(s, simText, evalRes, true);
      }
    });

    state.activeTab = "practice";
    state.showReport = true;
    saveRecords();
    renderAll();
    const repEl = document.getElementById("wholePassageReport");
    if (repEl) repEl.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(`已填入本篇模拟译文并完成整篇打分，收录 ${newlyAdded} 项薄弱词句至单词本`);
  }

  function renderPracticeWorkspace(container) {
    const passage = getCurrentPassage();
    if (!passage) return;
    const sents = getPassageSentences(passage);
    const allDone = sents.length > 0 && sents.every((s) => state.records[s.id] && state.records[s.id].submitted);

    let reportHtml = "";
    if (state.showReport || allDone) {
      const rep = computePassageReport(passage);
      reportHtml = `
        <section class="report-card" id="wholePassageReport">
          <div class="report-top">
            <div class="report-score-circle">
              <div class="big-score">
                <span class="num">${rep.avgScore}</span>
                <span class="unit">综合得分</span>
              </div>
              <div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                  <h3 style="font-size:18px;color:var(--ink-primary);">整篇精翻诊断报告 · ${escHtml(rep.grade)}</h3>
                  <span class="passage-meta-tag" style="margin:0;">已完成 ${rep.submittedCount}/${rep.total} 句</span>
                </div>
                <p style="font-size:13.5px;color:var(--ink-secondary);max-width:660px;">${escHtml(rep.summaryAdvice)}</p>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn btn-amber" id="btnCollectAllPassageWeak">
                一键收录本篇全部错漏词句 (${rep.missedVocabAll.length + rep.missedPatternAll.length})
              </button>
              <button class="btn btn-primary" id="btnGoToNotebookFromReport">
                查看单词本并导出 PDF
              </button>
            </div>
          </div>

          <div class="metrics-grid">
            <div class="metric-box">
              <div class="metric-label">语义词块还原度</div>
              <div class="metric-val" style="color:var(--brand-navy);">${rep.avgChunk}%</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">核心词汇准确度</div>
              <div class="metric-val" style="color:var(--accent-green);">${rep.avgVocab}%</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">长难句型结构分</div>
              <div class="metric-val" style="color:var(--accent-amber);">${rep.avgPattern}%</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">待攻克词块 / 句型数</div>
              <div class="metric-val" style="color:var(--accent-red);">${rep.missedVocabAll.length} 词 / ${rep.missedPatternAll.length} 句型</div>
            </div>
          </div>

          <div class="report-columns">
            <div class="report-subcard">
              <h4>
                <span>未译出 / 翻译偏差的核心单词与短语 (${rep.missedVocabAll.length})</span>
              </h4>
              <div class="weak-list">
                ${
                  rep.missedVocabAll.length === 0
                    ? `<div style="color:var(--accent-green);font-size:13px;padding:8px 0;">太棒了！本篇所有核心词汇与短语均已准确译出。</div>`
                    : rep.missedVocabAll
                        .map((item) => {
                          const inNb = isInNotebook("vocab", item.vocab.word, item.sent.id);
                          return `
                          <div class="weak-item">
                            <div>
                              <div style="font-weight:700;color:var(--ink-primary);font-size:14px;">
                                ${escHtml(item.vocab.word)}
                                <span style="font-size:11.5px;color:var(--accent-amber);font-weight:600;margin-left:6px;">[${escHtml(item.vocab.status)} · ${item.sent.code}]</span>
                              </div>
                              <div style="font-size:12.5px;color:var(--ink-secondary);">${escHtml(item.vocab.meaning)} ${item.vocab.context_zh ? `（语境：${escHtml(item.vocab.context_zh)}）` : ""}</div>
                            </div>
                            <button class="btn btn-sm ${inNb ? "btn-soft" : "btn-outline"}"
                              data-add-vocab="${escHtml(item.vocab.word)}"
                              data-sent-id="${item.sent.id}">
                              ${inNb ? "已在单词本" : "+ 单词本"}
                            </button>
                          </div>
                        `;
                        })
                        .join("")
                }
              </div>
            </div>

            <div class="report-subcard">
              <h4>
                <span>未译出 / 需强化的长难句型结构 (${rep.missedPatternAll.length})</span>
              </h4>
              <div class="weak-list">
                ${
                  rep.missedPatternAll.length === 0
                    ? `<div style="color:var(--accent-green);font-size:13px;padding:8px 0;">本篇所有长难句型与从句结构均已准确还原！</div>`
                    : rep.missedPatternAll
                        .map((item) => {
                          const inNb = isInNotebook("pattern", item.pattern.name, item.sent.id);
                          return `
                          <div class="weak-item">
                            <div>
                              <div style="font-weight:700;color:var(--ink-primary);font-size:14px;">
                                ${escHtml(item.pattern.name)}
                                <span style="font-size:11.5px;color:var(--accent-amber);font-weight:600;margin-left:6px;">[${escHtml(item.pattern.status)} · ${item.sent.code}]</span>
                              </div>
                              <div style="font-size:12.5px;color:var(--brand-navy);">${escHtml(item.pattern.en_anchor)} → ${escHtml(item.pattern.zh_anchor)}</div>
                              <div style="font-size:12px;color:var(--ink-muted);margin-top:2px;">${escHtml(item.pattern.note)}</div>
                            </div>
                            <button class="btn btn-sm ${inNb ? "btn-soft" : "btn-outline"}"
                              data-add-pattern="${escHtml(item.pattern.name)}"
                              data-sent-id="${item.sent.id}">
                              ${inNb ? "已在单词本" : "+ 句型本"}
                            </button>
                          </div>
                        `;
                        })
                        .join("")
                }
              </div>
            </div>
          </div>
        </section>
      `;
    }

    const paragraphsHtml = passage.paragraphs
      .map((para, pIdx) => {
        const pNum = pIdx + 1;
        const cardsHtml = para.sentences
          .map((s) => renderSentenceCard(s))
          .join("");
        return `
        <section class="para-section">
          <div class="para-banner">
            <span class="para-badge">Paragraph ${pNum}</span>
            <span class="para-summary">${escHtml(para.summary)}</span>
          </div>
          <div class="sentences-list">
            ${cardsHtml}
          </div>
        </section>
      `;
      })
      .join("");

    const doneCount = sents.filter((s) => state.records[s.id] && state.records[s.id].submitted).length;
    const pctVal = sents.length ? Math.round((doneCount / sents.length) * 100) : 0;
    container.innerHTML = `
      <!-- Floating Translation Progress Indicator -->
      <div class="floating-progress-widget" id="floatProgWidget" onclick="document.getElementById('progressCard')?.scrollIntoView({behavior:'smooth'})">
        <div class="float-prog-circle" style="background: conic-gradient(var(--brand-navy) ${pctVal * 3.6}deg, #E2E8F0 ${pctVal * 3.6}deg);">
          <span class="float-prog-num">${pctVal}%</span>
        </div>
        <div class="float-prog-text">
          <span class="float-prog-label">全文翻译进度</span>
          <span class="float-prog-val">已译 ${doneCount} / ${sents.length} 句</span>
        </div>
      </div>

      <div class="workspace-toolbar">
        <div class="toolbar-left">
          <strong style="color:var(--brand-navy);">逐句精翻实训模式：</strong>
          <span style="font-size:13px;color:var(--ink-secondary);">在英文原句下方输入你的译文，点击“提交并对照答案”（或按 Ctrl/⌘+Enter）即可显示逐块精译与评分诊断。</span>
        </div>
        <div class="toolbar-right">
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-secondary);cursor:pointer;">
            <input type="checkbox" id="chkAutoCollect" ${state.autoCollectWeak ? "checked" : ""} />
            自动将未译出/译错词句收入单词本
          </label>
          <button class="btn btn-sm btn-outline" id="btnRevealAll">展开全部参考答案</button>
        </div>
      </div>
      ${reportHtml}
      ${paragraphsHtml}
    `;

    // Bind toolbar events
    const chkAuto = document.getElementById("chkAutoCollect");
    if (chkAuto) {
      chkAuto.addEventListener("change", (e) => {
        state.autoCollectWeak = e.target.checked;
        saveUi();
      });
    }

    const btnRevealAll = document.getElementById("btnRevealAll");
    if (btnRevealAll) {
      btnRevealAll.addEventListener("click", () => {
        handleFinishWholePassage();
      });
    }

    const btnCollectAll = document.getElementById("btnCollectAllPassageWeak");
    if (btnCollectAll) {
      btnCollectAll.addEventListener("click", () => {
        let count = 0;
        sents.forEach((s) => {
          const rec = state.records[s.id];
          const userZh = rec ? rec.userZh : "";
          const evalRes = rec && rec.evalResult ? rec.evalResult : evaluateSentence(s, userZh);
          count += collectSentenceWeaknesses(s, userZh, evalRes, true);
        });
        renderAll();
        showToast(`已将本篇全部未译出/偏差词句整理至单词本（新增 ${count} 条）`);
      });
    }

    const btnGoNb = document.getElementById("btnGoToNotebookFromReport");
    if (btnGoNb) {
      btnGoNb.addEventListener("click", () => {
        state.activeTab = "notebook";
        renderAll();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }

    bindSentenceEvents(container, sents);
  }

  function renderSentenceCard(s) {
    const rec = state.records[s.id] || { userZh: "", submitted: false, evalResult: null };
    const isSubmitted = Boolean(rec.submitted && rec.evalResult);
    const ev = rec.evalResult;

    let scoreBadgeHtml = `<div class="sent-score-badge pending" title="待翻译作答"><span class="badge-dot"></span></div>`;
    if (isSubmitted && ev) {
      const cls = ev.score >= 85 ? "high" : ev.score >= 65 ? "mid" : "low";
      scoreBadgeHtml = `<div class="sent-score-badge ${cls}" title="本句得分：${ev.score}分"><span class="score-num">${ev.score}</span></div>`;
    }

    const patternPills = (s.patterns || [])
      .map((p) => `<span class="pattern-tag">${escHtml(p.name)}</span>`)
      .join("");

    let answerPanelHtml = "";
    if (isSubmitted && ev) {
      const chunksHtml = (ev.chunkResults || [])
        .map(
          (c) => `
          <div class="chunk-chip ${c.hit ? "hit" : "miss"}">
            <span class="chunk-status-tag">${c.hit ? "✓ 已译出" : "! 待强化"}</span>
            <div class="chunk-en">${escHtml(c.en)}</div>
            <div class="chunk-zh">${escHtml(c.zh)}</div>
          </div>
        `
        )
        .join("");

      const vocabPillsHtml = (ev.vocabResults || [])
        .map((v) => {
          const inNb = isInNotebook("vocab", v.word, s.id);
          return `
            <button class="vocab-item-pill ${!v.hit ? "missed" : ""} ${inNb ? "in-notebook" : ""}"
              data-add-vocab="${escHtml(v.word)}"
              data-sent-id="${s.id}"
              title="点击加入或更新至单词本">
              <strong>${escHtml(v.word)}</strong>
              <span>${escHtml(v.meaning)}</span>
              <span style="font-weight:700;">${inNb ? "★ 已收录" : !v.hit ? `[${v.status} · +单词本]` : "+收藏"}</span>
            </button>
          `;
        })
        .join("");

      const patternCollectHtml = (ev.patternResults || [])
        .map((p) => {
          const inNb = isInNotebook("pattern", p.name, s.id);
          return `
            <button class="vocab-item-pill ${!p.hit ? "missed" : ""} ${inNb ? "in-notebook" : ""}"
              data-add-pattern="${escHtml(p.name)}"
              data-sent-id="${s.id}"
              title="点击将该句型结构加入单词与句型本">
              <strong>句型：${escHtml(p.name)}</strong>
              <span>${inNb ? "★ 已在句型本" : !p.hit ? `[${p.status} · +句型本]` : "+收藏句型"}</span>
            </button>
          `;
        })
        .join("");

      answerPanelHtml = `
        <div class="answer-panel">
          <div class="ref-zh-box">
            <div class="ref-label">
              <span>参考标准精译（对照你的译文）</span>
              <span>${escHtml(ev.feedback)}</span>
            </div>
            <div class="ref-zh-text">${escHtml(s.zh)}</div>
          </div>

          <div>
            <div style="font-size:12px;font-weight:700;color:var(--ink-secondary);margin-bottom:6px;">
              逐语块切分与采分点核对（绿色=已译出，橙色=漏译或偏差）：
            </div>
            <div class="chunks-grid">
              ${chunksHtml}
            </div>
          </div>

          <div class="syntax-note-box">
            <strong>句法与阅读精析：</strong>${escHtml(s.note)}
          </div>

          <div class="diag-collect-box">
            <div class="diag-title">
              <span>本句核心词汇与句型诊断（点击任意词条可随时加入/同步至单词本）：</span>
            </div>
            <div class="vocab-chips-row">
              ${vocabPillsHtml}
              ${patternCollectHtml}
            </div>
          </div>
        </div>
      `;
    }

    return `
      <article class="sent-card ${isSubmitted ? "submitted" : ""}" id="card-${s.id}">
        <div class="sent-top-row">
          <div class="sent-code-group">
            <span class="sent-code">${s.code}</span>
            ${patternPills}
          </div>
          ${scoreBadgeHtml}
        </div>

        <div class="sent-en-text">${escHtml(s.en)}</div>

        <div class="trans-input-wrap">
          <textarea
            id="input-${s.id}"
            class="trans-textarea"
            data-sent-input="${s.id}"
            placeholder="在此输入中文翻译..." rows="2" style="overflow:hidden;" oninput="this.style.height='auto';this.style.height=(this.scrollHeight)+'px';"
          >${escHtml(rec.userZh || "")}</textarea>

          <div class="input-actions-bar">
            <span class="input-hint"></span>
            <div class="input-btns">
              ${
                isSubmitted
                  ? `<button class="btn btn-sm btn-outline" data-regrade="${s.id}">修改后重新评分</button>`
                  : `<button class="btn btn-sm btn-outline" data-peek="${s.id}">直接看答案（记入待攻克）</button>`
              }
              <button class="btn btn-sm btn-primary" data-submit="${s.id}">
                ${isSubmitted ? "更新译文并重判" : "提交并显示答案"}
              </button>
            </div>
          </div>
        </div>

        ${answerPanelHtml}
      </article>
    `;
  }

  function bindSentenceEvents(container, sents) {
    const sentMap = {};
    sents.forEach((s) => (sentMap[s.id] = s));

    // Textarea auto-resize, draft saving & Ctrl+Enter shortcut
    container.querySelectorAll("[data-sent-input]").forEach((ta) => {
      // Auto adjust initial height based on content
      ta.style.height = "auto";
      ta.style.height = Math.max(54, ta.scrollHeight) + "px";
      const sid = ta.dataset.sentInput;
      ta.addEventListener("input", () => {
        if (!state.records[sid]) state.records[sid] = { userZh: "", submitted: false };
        state.records[sid].userZh = ta.value;
        saveRecords();
      });
      ta.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          submitSingleSentence(sentMap[sid], ta.value);
        }
      });
    });

    container.querySelectorAll("[data-submit], [data-regrade]").forEach((btn) => {
      const sid = btn.dataset.submit || btn.dataset.regrade;
      btn.addEventListener("click", () => {
        const ta = document.getElementById(`input-${sid}`);
        const val = ta ? ta.value : "";
        submitSingleSentence(sentMap[sid], val);
      });
    });

    container.querySelectorAll("[data-peek]").forEach((btn) => {
      const sid = btn.dataset.peek;
      btn.addEventListener("click", () => {
        const ta = document.getElementById(`input-${sid}`);
        const val = ta ? ta.value : "";
        submitSingleSentence(sentMap[sid], val, true);
      });
    });

    // Add single vocab or pattern to notebook
    container.querySelectorAll("[data-add-vocab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const word = btn.dataset.addVocab;
        const sid = btn.dataset.sentId;
        const s = sentMap[sid];
        if (!s) return;
        const vObj = (s.vocab || []).find((v) => v.word === word);
        if (!vObj) return;
        const rec = state.records[sid] || {};
        toggleNotebookItem({
          id: makeNotebookId("vocab", vObj.word, s.id),
          sentId: s.id,
          kind: "vocab",
          term: vObj.word,
          meaning: vObj.meaning,
          context_zh: vObj.context_zh || "",
          source: `${state.year} Text ${state.textId} · ${s.code}`,
          reason: "手动/错题强化",
          en: s.en,
          zh: s.zh,
          user_zh: rec.userZh || "",
          note: s.note || "",
        });
        renderAll();
      });
    });

    container.querySelectorAll("[data-add-pattern]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const patName = btn.dataset.addPattern;
        const sid = btn.dataset.sentId;
        const s = sentMap[sid];
        if (!s) return;
        const pObj = (s.patterns || []).find((p) => p.name === patName);
        if (!pObj) return;
        const rec = state.records[sid] || {};
        toggleNotebookItem({
          id: makeNotebookId("pattern", pObj.name, s.id),
          sentId: s.id,
          kind: "pattern",
          term: pObj.name,
          meaning: `${pObj.en_anchor} → ${pObj.zh_anchor}`,
          context_zh: pObj.zh_anchor || "",
          source: `${state.year} Text ${state.textId} · ${s.code}`,
          reason: "句型收藏强化",
          en: s.en,
          zh: s.zh,
          user_zh: rec.userZh || "",
          note: `${pObj.note || ""}（点拨：${pObj.advice || ""}）`,
        });
        renderAll();
      });
    });
  }

  function submitSingleSentence(sent, userZh, isPeek = false) {
    if (!sent) return;
    const trimmed = String(userZh || "").trim();
    const evalRes = evaluateSentence(sent, trimmed);
    state.records[sent.id] = {
      userZh: trimmed,
      submitted: true,
      evalResult: evalRes,
      ts: Date.now(),
    };

    let added = 0;
    if (state.autoCollectWeak) {
      added = collectSentenceWeaknesses(sent, trimmed, evalRes, true);
    }

    // Check if all sentences in passage are now completed
    const passage = getCurrentPassage();
    const allSents = getPassageSentences(passage);
    const allDone = allSents.every((s) => state.records[s.id] && state.records[s.id].submitted);
    if (allDone) {
      state.showReport = true;
    }

    saveRecords();
    renderAll();

    if (allDone) {
      showToast(`恭喜完成整篇精翻！综合诊断报告已生成${added ? `，新增 ${added} 项入单词本` : ""}`);
    } else if (isPeek && !trimmed) {
      showToast(`已显示 ${sent.code} 标准答案，未译出词句已自动记入单词本`);
    } else {
      showToast(`${sent.code} 批改完成：得分 ${evalRes.score} 分${added ? `（${added} 项薄弱点已入单词本）` : ""}`);
    }
  }

  // =========================================================================
  // Tab 02: Overview & Mindmap
  // =========================================================================
  function renderOverviewWorkspace(container) {
    const passage = getCurrentPassage();
    if (!passage) return;

    container.innerHTML = `
      <div class="card">
        <span class="passage-meta-tag">${state.year} 英语（二） · Text ${passage.id} · 01 篇章综述与逻辑导图</span>
        <h2 style="font-size:20px;margin:6px 0 12px;color:var(--ink-primary);">${escHtml(passage.title)}</h2>
        <p style="font-size:14.5px;color:var(--brand-navy);background:var(--brand-blue-soft);padding:12px 15px;border-radius:var(--radius-sm);font-weight:600;margin-bottom:18px;">
          全文逻辑主线：${escHtml(passage.logic)}
        </p>

        <h3 style="font-size:15.5px;margin-bottom:12px;color:var(--ink-primary);">段落大意与句群推进脉络</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${passage.paragraphs
            .map(
              (p, idx) => `
            <div style="border:1px solid var(--border-light);border-radius:var(--radius-sm);padding:14px;background:#FCFDFE;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span class="para-badge">Paragraph ${idx + 1}</span>
                <span style="font-size:12px;color:var(--ink-muted);">共 ${p.sentences.length} 句</span>
              </div>
              <div style="font-weight:700;color:var(--brand-navy-dark);margin-bottom:6px;">${escHtml(p.summary)}</div>
              <div style="font-size:13.5px;color:var(--ink-secondary);font-family:var(--font-serif-zh);">
                ${p.sentences.map((s) => `<span style="margin-right:8px;"><strong>[${s.code}]</strong> ${escHtml(s.zh)}</span>`).join("")}
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Tab 03: Reading Comprehension Questions
  // =========================================================================
  function renderQuestionsWorkspace(container) {
    const passage = getCurrentPassage();
    if (!passage) return;

    const qCards = (passage.questions || [])
      .map((q) => {
        const examTag = (state.exam && state.exam.includes("一")) ? "E1" : "E2";
        const qKey = `${state.year}-${examTag}-T${passage.id}-Q${q.n}`;
        const picked = state.qAnswers[qKey];
        const letters = ["A", "B", "C", "D"];

        const optsHtml = (q.options || [])
          .map((opt, idx) => {
            const letter = letters[idx] || String(idx);
            let cls = "";
            if (picked) {
              if (letter === q.answer) cls = "correct";
              else if (letter === picked && picked !== q.answer) cls = "wrong";
            }
            return `
              <div class="opt-item ${cls}" data-qkey="${qKey}" data-letter="${letter}">
                <div style="display:flex;justify-content:space-between;gap:8px;font-weight:600;color:var(--ink-primary);">
                  <span><strong>[${letter}]</strong> ${escHtml(opt.en || opt[0] || "")}</span>
                  ${picked && letter === q.answer ? `<span style="color:var(--accent-green);font-size:12px;">✓ 正确选项</span>` : ""}
                </div>
                ${
                  picked
                    ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border-light);font-size:13px;color:var(--ink-secondary);">
                        ${(opt.zh || opt[1]) ? `<div><strong>选项译文：</strong>${escHtml(opt.zh || opt[1])}</div>` : ""}
                        ${(opt.reason || opt[2]) ? `<div style="margin-top:2px;color:${letter === q.answer ? "var(--accent-green)" : "var(--ink-muted)"};"><strong>命题意图解析：</strong>${escHtml(opt.reason || opt[2])}</div>` : ""}
                      </div>`
                    : ""
                }
              </div>
            `;
          })
          .join("");

        return `
          <article class="question-card">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <div>
                <span class="para-badge">Q${q.n} · ${escHtml(q.kind)}</span>
                <span style="font-size:12.5px;color:var(--ink-muted);margin-left:8px;">定位句：${escHtml(q.loc)}</span>
              </div>
              <button class="btn btn-sm btn-outline" data-toggle-q="${qKey}" data-ans="${q.answer}">
                ${picked ? "隐藏解析重做" : "直接显示答案解析"}
              </button>
            </div>
            <div style="font-family:var(--font-serif-en);font-size:16px;font-weight:600;color:var(--ink-primary);">
              ${escHtml(q.stem)}
            </div>
            ${picked ? `<div style="font-size:14px;color:var(--brand-navy);font-weight:600;">题干译文：${escHtml(q.zh)}</div>` : ""}
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${optsHtml}
            </div>
            ${
              picked
                ? `<div class="syntax-note-box">
                    <strong>定位依据与解题闭环（正解 ${escHtml(q.answer)}）：</strong>${escHtml(q.evidence)}
                  </div>`
                : ""
            }
          </article>
        `;
      })
      .join("");

    container.innerHTML = `
      <div class="workspace-toolbar">
        <div>
          <strong style="color:var(--brand-navy);">真题阅读选项精析（Q${passage.questions[0]?.n || 21}–Q${passage.questions[passage.questions.length - 1]?.n || 25}）：</strong>
          <span style="font-size:13px;color:var(--ink-secondary);">点击任一选项即可完成作答并展开四项精译与正误排除解析。</span>
        </div>
      </div>
      ${qCards}
    `;

    container.querySelectorAll("[data-qkey]").forEach((el) => {
      el.addEventListener("click", () => {
        state.qAnswers[el.dataset.qkey] = el.dataset.letter;
        saveQAnswers();
        renderAll();
      });
    });

    container.querySelectorAll("[data-toggle-q]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.toggleQ;
        if (state.qAnswers[k]) delete state.qAnswers[k];
        else state.qAnswers[k] = btn.dataset.ans;
        saveQAnswers();
        renderAll();
      });
    });
  }

  // =========================================================================
  // Tab 04: Vocabulary & Sentence Pattern Notebook + PDF Export
  // =========================================================================
  function getFilteredNotebook() {
    return state.notebook.filter((item) => {
      if (state.nbFilter === "vocab" && item.kind !== "vocab") return false;
      if (state.nbFilter === "pattern" && item.kind !== "pattern") return false;
      if (state.nbFilter === "unmastered" && item.mastered) return false;
      if (state.nbSearch) {
        const q = state.nbSearch.toLowerCase();
        const hay = `${item.term} ${item.meaning} ${item.source} ${item.en} ${item.zh}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  async function handleExportPdf() {
    const filtered = getFilteredNotebook();
    const targetItems = filtered.length > 0 ? filtered : state.notebook;
    if (targetItems.length === 0) {
      showToast("单词本当前为空，请先在精翻实训中提交译文或点击收录词句！");
      return;
    }

    showToast("正在生成高清 A4 印刷级单词与句型本 PDF...");
    try {
      const resp = await fetch("/api/export-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "考研英语（二）阅读精翻 · 错题单词与长难句型复盘本",
          subtitle: `收录范围：2015–2026 真题精翻实训 · 共 ${targetItems.length} 条重点词句`,
          items: targetItems,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `考研英语二-阅读精翻单词与句型本-${targetItems.length}条.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast("PDF 导出成功！已开始下载《考研英语二-阅读精翻单词与句型本.pdf》");
    } catch (err) {
      console.warn("Backend PDF export fallback to window.print():", err);
      showToast("正在调起浏览器原生 PDF 打印导出...");
      window.print();
    }
  }


  // =========================================================================
  // Data Backup & Restore (JSON Export / Import)
  // =========================================================================
  function exportBackupData() {
    const backup = {
      app: "kaoyan_reading_jingfan",
      version: "1.0",
      exportTime: new Date().toISOString(),
      records: state.records || {},
      notebook: state.notebook || [],
      qAnswers: state.qAnswers || {},
      ui: {
        exam: state.exam,
        year: state.year,
        textId: state.textId,
        autoCollectWeak: state.autoCollectWeak,
      },
    };
    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `考研英语精翻学习记录备份_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("学习记录与单词本已成功导出备份！");
  }

  function importBackupData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || typeof data !== "object") throw new Error("无效的备份文件结构");

        let recCount = 0;
        let nbCount = 0;

        if (data.records && typeof data.records === "object") {
          state.records = Object.assign({}, state.records, data.records);
          recCount = Object.keys(data.records).length;
          saveRecords();
        }

        if (Array.isArray(data.notebook)) {
          const existingIds = new Set(state.notebook.map((x) => x.id));
          data.notebook.forEach((item) => {
            if (!existingIds.has(item.id)) {
              state.notebook.push(item);
              existingIds.add(item.id);
              nbCount++;
            }
          });
          saveNotebook();
        }

        if (data.qAnswers && typeof data.qAnswers === "object") {
          state.qAnswers = Object.assign({}, state.qAnswers, data.qAnswers);
          saveQAnswers();
        }

        if (data.ui && typeof data.ui === "object") {
          if (data.ui.exam) state.exam = data.ui.exam;
          if (data.ui.year) state.year = data.ui.year;
          if (data.ui.textId) state.textId = data.ui.textId;
          saveUi();
        }

        migrateHistoricalKeys();
        renderAll();
        showToast(`成功恢复：合并了 ${recCount} 条答题记录与 ${nbCount} 条生词句型！`);
      } catch (err) {
        alert("导入失败：请确认上传的是本平台导出的标准备份 JSON 文件。");
      }
    };
    reader.readAsText(file);
  }

  function initModals() {
    const modalDisclaimer = document.getElementById("disclaimerModal");
    const modalAbout = document.getElementById("aboutModal");

    const btnOpenDisclaimer = document.getElementById("btnOpenDisclaimer");
    if (btnOpenDisclaimer) {
      btnOpenDisclaimer.addEventListener("click", () => {
        if (modalDisclaimer) modalDisclaimer.style.display = "flex";
      });
    }

    const btnOpenAbout = document.getElementById("btnOpenAbout");
    if (btnOpenAbout) {
      btnOpenAbout.addEventListener("click", () => {
        if (modalAbout) modalAbout.style.display = "flex";
      });
    }

    document.querySelectorAll(".app-modal").forEach((m) => {
      m.addEventListener("click", (e) => {
        if (
          e.target === m ||
          e.target.classList.contains("modal-backdrop") ||
          e.target.classList.contains("modal-close") ||
          e.target.classList.contains("btn-close-modal")
        ) {
          m.style.display = "none";
        }
      });
    });
  }

  function renderNotebookWorkspace(container) {
    const filtered = getFilteredNotebook();
    const vocabCnt = state.notebook.filter((x) => x.kind === "vocab").length;
    const patCnt = state.notebook.filter((x) => x.kind === "pattern").length;
    const unmasteredCnt = state.notebook.filter((x) => !x.mastered).length;

    const cardsHtml =
      filtered.length === 0
        ? `
        <div class="card" style="grid-column:1/-1;text-align:center;padding:42px 20px;">
          <h3 style="font-size:17px;color:var(--ink-primary);margin-bottom:8px;">当前筛选条件下暂无单词或句型记录</h3>
          <p style="font-size:13.5px;color:var(--ink-secondary);max-width:520px;margin:0 auto 16px;">
            当你在「01 逐句精翻实训」中提交译文或完成整篇打分时，系统会自动将未译出、翻译错的核心单词与长难句型汇总到这里。
          </p>
          <button class="btn btn-primary" id="btnGoPracticeFromEmpty">前往逐句精翻实训</button>
        </div>
      `
        : filtered
            .map(
              (item) => `
          <article class="nb-card ${item.kind === "pattern" ? "pattern-card" : "vocab-card"}">
            <div class="nb-card-top">
              <div>
                <span class="passage-meta-tag" style="margin-bottom:4px;background:${item.kind === "pattern" ? "var(--accent-amber-soft)" : "var(--brand-blue-soft)"};color:${item.kind === "pattern" ? "var(--accent-amber)" : "var(--brand-navy)"};">
                  ${item.kind === "pattern" ? "长难句型结构" : "核心单词/短语"} · ${escHtml(item.reason || "重点强化")}
                </span>
                <div class="nb-term">${escHtml(item.term)}</div>
              </div>
              <span style="font-size:12px;color:var(--ink-muted);font-weight:600;">${escHtml(item.source)}</span>
            </div>

            <div class="nb-meaning">
              ${escHtml(item.meaning)}
              ${item.context_zh && item.kind === "vocab" ? `<span style="font-size:12.5px;color:var(--brand-navy);margin-left:6px;">（句中语境义：${escHtml(item.context_zh)}）</span>` : ""}
            </div>

            <div class="nb-context">
              <div><strong>真题原句：</strong><span style="font-family:var(--font-serif-en);">${escHtml(item.en)}</span></div>
              <div style="color:var(--brand-navy);"><strong>标准精译：</strong>${escHtml(item.zh)}</div>
              <div style="color:var(--accent-amber);"><strong>我的译文：</strong>${escHtml(item.user_zh || "（练习时漏译该项）")}</div>
              ${item.note ? `<div style="color:var(--accent-green);"><strong>句法点拨：</strong>${escHtml(item.note)}</div>` : ""}
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:6px;" class="no-print">
              <button class="btn btn-sm ${item.mastered ? "btn-soft" : "btn-outline"}" data-toggle-master="${escHtml(item.id)}">
                ${item.mastered ? "✓ 已掌握（点击取消）" : "标记为已掌握"}
              </button>
              <button class="btn btn-sm btn-outline" style="color:var(--accent-red);" data-remove-nb="${escHtml(item.id)}">
                移除
              </button>
            </div>
          </article>
        `
            )
            .join("");

    container.innerHTML = `
      <section class="notebook-header-card">
        <div>
          <h2>考研英语（二）精翻错题 · 单词与句型本</h2>
          <p>自动汇集逐句精翻中未译出、翻译偏差的核心词汇短语与长难句型，支持一键导出高清 A4 复习 PDF</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;" class="no-print">
          <button class="btn btn-amber" id="btnExportPdfMain" style="font-size:14.5px;padding:10px 18px;">
            导出单词与句型本 PDF (${filtered.length || state.notebook.length} 条)
          </button>
          <button class="btn btn-outline" id="btnExportBackup" style="background:rgba(255,255,255,0.12);color:#fff;border-color:rgba(255,255,255,0.3);">
            📥 备份学习记录 (JSON)
          </button>
          <button class="btn btn-outline" id="btnImportBackup" style="background:rgba(255,255,255,0.12);color:#fff;border-color:rgba(255,255,255,0.3);">
            📤 恢复本地备份
          </button>
          <input type="file" id="inputRestoreBackupFile" accept=".json" style="display:none;" />
          <button class="btn btn-outline" id="btnShowAddCustom" style="background:rgba(255,255,255,0.12);color:#fff;border-color:rgba(255,255,255,0.3);">
            + 手动添加词条/句型
          </button>
        </div>
      </section>

      <!-- Optional Manual Add Drawer -->
      <section class="card no-print" id="customAddBox" style="display:none;">
        <h4 style="margin-bottom:10px;color:var(--brand-navy);">手动添加重点单词或长难句型至单词本</h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:10px;">
          <select id="customKind" class="year-select">
            <option value="vocab">类型：核心单词 / 词块</option>
            <option value="pattern">类型：长难句型结构</option>
          </select>
          <input id="customTerm" class="year-select" placeholder="英文单词/词块 或 句型名称" />
          <input id="customMeaning" class="year-select" placeholder="中文核心释义 或 句型转换规则" />
          <input id="customEn" class="year-select" placeholder="例句英文（选填）" />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button class="btn btn-sm btn-primary" id="btnSaveCustomNb">保存至单词本</button>
        </div>
      </section>

      <section class="notebook-controls no-print">
        <div class="filter-pills">
          <button class="filter-pill ${state.nbFilter === "all" ? "active" : ""}" data-nb-filter="all">
            全部收录 (${state.notebook.length})
          </button>
          <button class="filter-pill ${state.nbFilter === "vocab" ? "active" : ""}" data-nb-filter="vocab">
            核心单词/短语 (${vocabCnt})
          </button>
          <button class="filter-pill ${state.nbFilter === "pattern" ? "active" : ""}" data-nb-filter="pattern">
            长难句型结构 (${patCnt})
          </button>
          <button class="filter-pill ${state.nbFilter === "unmastered" ? "active" : ""}" data-nb-filter="unmastered">
            待重点攻克 (${unmasteredCnt})
          </button>
        </div>

        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <input
            type="search"
            id="nbSearchInput"
            class="year-select"
            style="min-width:210px;"
            placeholder="搜索英文、释义或年份..."
            value="${escHtml(state.nbSearch)}"
          />
          ${
            state.notebook.length > 0
              ? `<button class="btn btn-sm btn-outline" id="btnClearNotebook" style="color:var(--accent-red);">清空全部</button>`
              : ""
          }
        </div>
      </section>

      <section class="notebook-grid">
        ${cardsHtml}
      </section>
    `;

    const btnExport = document.getElementById("btnExportPdfMain");
    if (btnExport) btnExport.addEventListener("click", handleExportPdf);

    const btnShowCustom = document.getElementById("btnShowAddCustom");
    const customBox = document.getElementById("customAddBox");
    if (btnShowCustom && customBox) {
      btnShowCustom.addEventListener("click", () => {
        customBox.style.display = customBox.style.display === "none" ? "block" : "none";
      });
    }

    const btnSaveCustom = document.getElementById("btnSaveCustomNb");
    if (btnSaveCustom) {
      btnSaveCustom.addEventListener("click", () => {
        const kind = document.getElementById("customKind").value;
        const term = document.getElementById("customTerm").value.trim();
        const meaning = document.getElementById("customMeaning").value.trim();
        const en = document.getElementById("customEn").value.trim();
        if (!term || !meaning) {
          showToast("请填写单词/句型名称与中文释义");
          return;
        }
        upsertNotebookItem({
          id: makeNotebookId(kind, term, `custom-${Date.now()}`),
          kind,
          term,
          meaning,
          context_zh: "",
          source: `${state.year} Text ${state.textId} · 手动整理`,
          reason: "手动收录",
          en: en || "（自定义补充词条）",
          zh: meaning,
          user_zh: "",
          note: "",
        });
        renderAll();
      });
    }

    container.querySelectorAll("[data-nb-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.nbFilter = btn.dataset.nbFilter;
        renderAll();
      });
    });

    const searchIn = document.getElementById("nbSearchInput");
    if (searchIn) {
      searchIn.addEventListener("input", (e) => {
        state.nbSearch = e.target.value;
        renderNotebookWorkspace(container);
        const newIn = document.getElementById("nbSearchInput");
        if (newIn) {
          newIn.focus();
          newIn.setSelectionRange(newIn.value.length, newIn.value.length);
        }
      });
    }

    const btnGoPrac = document.getElementById("btnGoPracticeFromEmpty");
    if (btnGoPrac) {
      btnGoPrac.addEventListener("click", () => {
        state.activeTab = "practice";
        renderAll();
      });
    }

    container.querySelectorAll("[data-toggle-master]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.toggleMaster;
        const item = state.notebook.find((x) => x.id === id);
        if (item) {
          item.mastered = !item.mastered;
          saveNotebook();
          renderAll();
        }
      });
    });

    container.querySelectorAll("[data-remove-nb]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.removeNb;
        state.notebook = state.notebook.filter((x) => x.id !== id);
        saveNotebook();
        renderAll();
        showToast("已从单词本移除该条目");
      });
    });

    const btnClear = document.getElementById("btnClearNotebook");
    if (btnClear) {
      btnClear.addEventListener("click", () => {
        if (confirm("确定要清空当前的单词与句型本吗？建议提前备份。")) {
          state.notebook = [];
          saveNotebook();
          renderAll();
          showToast("已清空单词本");
        }
      });
    }

    const btnExportBk = document.getElementById("btnExportBackup");
    if (btnExportBk) {
      btnExportBk.addEventListener("click", exportBackupData);
    }

    const btnImportBk = document.getElementById("btnImportBackup");
    const inputRestore = document.getElementById("inputRestoreBackupFile");
    if (btnImportBk && inputRestore) {
      btnImportBk.addEventListener("click", () => inputRestore.click());
      inputRestore.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
          importBackupData(e.target.files[0]);
          inputRestore.value = "";
        }
      });
    }
  }

  function renderAll() {
    renderHeaderControls();
    renderSidebar();
    const workspace = document.getElementById("workspaceArea");
    if (!workspace) return;
    if (state.activeTab === "practice") {
      renderPracticeWorkspace(workspace);
    } else if (state.activeTab === "overview") {
      renderOverviewWorkspace(workspace);
    } else if (state.activeTab === "questions") {
      renderQuestionsWorkspace(workspace);
    } else if (state.activeTab === "notebook") {
      renderNotebookWorkspace(workspace);
    }
  }

  async function init() {
    loadStorage();
    initModals();
    document.querySelectorAll("[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeTab = btn.dataset.tab;
        renderAll();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

    // Offline data.js already loaded
    if (Array.isArray(window.KAOYAN_JINGFAN_BANK) && window.KAOYAN_JINGFAN_BANK.length > 0) {
      BANK = window.KAOYAN_JINGFAN_BANK;
      BANK_MANIFEST = BANK.map((item) => ({
        exam: item.exam,
        year: item.year,
        title: item.title,
        scope: item.scope,
        texts: item.texts.map((t) => ({ id: t.id, title: t.title, genre: t.genre })),
      }));
      BANK.forEach((item) => {
        BANK_CHUNKS[getChunkKey(item.exam, item.year)] = item;
      });
      renderAll();
      return;
    }

    // Dynamic on-demand loading via manifest.json
    try {
      const res = await fetch("data/manifest.json");
      if (!res.ok) throw new Error("Manifest HTTP " + res.status);
      BANK_MANIFEST = await res.json();
      renderHeaderControls();
      await loadYearChunk(state.year, state.exam);
    } catch (e) {
      console.warn("Manifest loading failed, attempting offline bank fallback:", e);
      if (Array.isArray(window.KAOYAN_JINGFAN_BANK) && window.KAOYAN_JINGFAN_BANK.length > 0) {
        BANK = window.KAOYAN_JINGFAN_BANK;
        renderAll();
      } else {
        renderWorkspaceError("未能加载题库索引，请在 HTTP 服务器（如 python3 server.py）或支持静态托管的环境下运行。");
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
