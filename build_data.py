import json
import glob
import os
import re

PATTERN_RULES = [
    ("宾语从句", r"宾语从句", r"\b(suggests?|shows?|found|finds?|argues?|means?|believes?|concludes?|indicates?|reveals?|demonstrates?|claims?|notes?|says?|said|think|thinks|thought)\s+that\b", "动词或介词后引导宾语从句，翻译时通常保持“主谓 + 宾语内容”顺译，注意连接词 that 常省略。"),
    ("定语从句与后置修饰", r"定语从句|后置定语|关系代词|先行词", r"\b(who|whom|whose|which)\b", "修饰先行词的定语成分；短定语可前置译为“……的”，长定语或非限制性定语从句宜拆句顺译或重复先行词。"),
    ("让步与转折对照结构", r"让步|转折|对照|对比", r"\b(although|though|even if|even though|while|whereas|despite|in spite of|contrary to)\b", "表达“尽管/虽然……但是……”或前后反差对比关系，翻译时需显化转折或对照逻辑词。"),
    ("条件/时间/原因状语从句", r"条件状语|时间状语|原因状语|条件|原因", r"\b(unless|once|as long as|because|since|whenever|until)\b", "交代主句成立的条件、时间或原因，汉语习惯遵循“先偏后正”，常将状语从句置于主句前译出。"),
    ("非谓语动词构句（分词/不定式）", r"分词|不定式|动名词|作状语|作结果状语|作伴随状语|独立主格", r",\s*[a-z]+ing\b|\bto\s+[a-z]{3,}\b", "分词短语或不定式常表伴随、结果、目的或后置修饰，需根据与主句主语的逻辑关系转化为动词并列分句或目的状语。"),
    ("被动语态与无灵主语", r"被动", r"\b(is|are|was|were|be|been|being)\s+[a-z]+ed\b", "英语多用被动或抽象名词作主语，译成汉语时可转为“被/受到/由……”，或转换为主动句与汉语无主句。"),
    ("比较结构与量化对位", r"比较级|最高级|比较对象|比较结构", r"\b(more|less|fewer|higher|lower|better|worse|greater)\b.*\bthan\b|\bas\s+[a-z]+\s+as\b", "需准确对位比较主体与比较基准（than / as 后的成分），避免比较对象错位或漏译程度副词。"),
    ("破折号/插入语/同位语解释", r"破折号|插入语|同位语|冒号|括号|补充说明|解释说明", r"—|--", "双破折号、逗号插入语或同位语从句用于打断主干补充细节，翻译时宜先拎清主干，再通过破折号或分句承接。"),
    ("形式主语/形式宾语/强调句", r"形式主语|形式宾语|强调句", r"\bIt\s+(is|was|seems|appears|takes)\b|\b(make|find|consider)\s+it\b", "It 作形式主语/宾语时，真正主语/宾语在后置的 to do 或 that 从句中，可顺译为“……是……的”或把真主语提前。"),
    ("否定转移与倒装结构", r"倒装|双重否定|部分否定|否定", r"\b(not only|no longer|rarely|seldom|hardly|scarcely|fail to|fails to|failed to|far from)\b", "注意识别句首否定词倒装、fail to / far from 等隐性否定及 not...all 部分否定，确保全句肯否定方向准确。")
]

STOPWORDS = {
    "the","a","an","to","of","in","on","at","for","with","by","from","as","is","are","was","were","be","been","being",
    "that","which","who","whom","whose","this","these","those","it","its","they","them","their","he","she","his","her",
    "we","us","our","you","your","and","or","but","if","when","while","than","so","up","out","about","into","over","after",
    "more","most","some","any","no","not","only","also","very","just","can","could","will","would","should","may","might",
    "must","do","does","did","done","have","has","had","having","one","two","three","all","both","each","other","another",
    "such","what","how","why","where","there","here","then","now"
}

ZH_PARTICLES = set("的了着过地得和与及或而但又也还就都更最很太只把被向往从在当比跟同对关于对于之其乃则若虽即便将")

COMMON_SYNONYMS = {
    "表明": ["显示", "指出", "说明", "展示", "发现"],
    "暗示": ["表明", "说明", "意味着", "显示"],
    "调查": ["研究", "民调", "调研", "勘测"],
    "压力": ["焦虑", "紧张", "负担", "紧迫"],
    "实际上": ["事实上", "其实", "真正在", "实则"],
    "相反": ["相对", "背道而驰", "截然不同", "反过来"],
    "减少": ["降低", "削减", "缩减", "下降", "减轻"],
    "增加": ["提高", "增长", "提升", "增多", "上升", "加剧"],
    "重要": ["关键", "至关重要", "必要", "核心", "重大"],
    "影响": ["冲击", "作用", "效应", "左右", "波及"],
    "导致": ["引起", "造成", "引发", "促成", "带来"],
    "认为": ["相信", "主张", "觉得", "指出", "看来"],
    "尽管": ["虽然", "即便", "即使", "固然", "哪怕"],
    "然而": ["但是", "但", "不过", "却", "而"],
    "工作": ["上班", "职场", "岗位", "职业"],
    "家庭": ["家里", "家中", "居家", "在家"]
}

def extract_zh_keywords(gloss: str, add_synonyms=True):
    clean = re.sub(r"（.*?）|\(.*?\)", "", gloss)
    clean = re.sub(r"^[a-zA-Z]+\.\s*", "", clean)
    clean = re.sub(r"\.{2,}|…+", " ", clean)
    zh_runs = re.findall(r"[\u4e00-\u9fa5]+", clean)
    kws = []
    for run in zh_runs:
        core = run.strip("的了着过地得吗呢吧啊呀")
        if not core:
            core = run
        if len(core) >= 2 and core not in kws:
            kws.append(core)
        elif len(core) == 1 and core not in ZH_PARTICLES and core not in kws:
            kws.append(core)
        if len(core) >= 3:
            for i in range(len(core) - 1):
                bg = core[i:i+2]
                if not all(ch in ZH_PARTICLES for ch in bg) and bg not in kws:
                    kws.append(bg)
    if add_synonyms:
        extra = []
        for k in list(kws):
            for base, syns in COMMON_SYNONYMS.items():
                if base in k:
                    for s in syns:
                        if s not in kws and s not in extra:
                            extra.append(s)
        kws.extend(extra)
    return kws[:10]

def clean_definition(d: str, en_word: str, chunks: list):
    d = re.sub(r"（[^）]*的第三人称[^）]*）|\([^)]*复数[^)]*\)|（[^）]*复数[^）]*）|\([^)]*过去[^)]*\)|（[^）]*过去[^）]*）", "", d)
    d = re.sub(r"\s+", " ", d).strip()
    en_lower = en_word.lower()
    ctx_gloss = ""
    for c_en, c_zh in chunks:
        if en_lower in c_en.lower():
            ctx_gloss = c_zh.strip(" ，。；：？！“”‘’")
            break
    return d, ctx_gloss

def match_vocab_in_sentence(sent_en: str, para_vocab: list, chunks: list):
    sent_lower = sent_en.lower()
    matched = []
    seen = set()
    sorted_vocab = sorted(para_vocab, key=lambda x: (-len(x.get("word", "").split()), -len(x.get("word", ""))))
    for v in sorted_vocab:
        w = v.get("word", "").strip()
        d = v.get("definition", "").strip()
        if not w or not d or w.lower() in STOPWORDS:
            continue
        w_lower = w.lower()
        stem = w_lower[:-1] if len(w_lower) > 5 and w_lower.endswith("e") else (w_lower[:-2] if len(w_lower) > 6 and w_lower.endswith("ed") else w_lower)
        pattern = r"\b" + re.escape(stem)
        if re.search(pattern, sent_lower):
            if any(w_lower in existing or existing in w_lower for existing in seen):
                continue
            seen.add(w_lower)
            clean_d, ctx_gloss = clean_definition(d, w, chunks)
            # Only use the word's own definition + synonyms for word-level checking!
            kws = extract_zh_keywords(clean_d, add_synonyms=True)
            matched.append({
                "word": w,
                "meaning": clean_d,
                "context_zh": ctx_gloss,
                "kws": kws[:10]
            })
            if len(matched) >= 5:
                break

    # Limit fallback extraction
    pass
    return matched[:5]

def detect_patterns(sent_en: str, note: str, chunks: list):
    found = []
    seen_names = set()
    combined_note = note or ""
    for pat_name, note_regex, en_regex, advice in PATTERN_RULES:
        if re.search(note_regex, combined_note, re.I):
            rel_chunk = chunks[0] if chunks else [sent_en, ""]
            for c in chunks:
                if re.search(en_regex, c[0], re.I):
                    rel_chunk = c
                    break
            seen_names.add(pat_name)
            found.append({
                "name": pat_name,
                "en_anchor": rel_chunk[0],
                "zh_anchor": rel_chunk[1],
                "note": combined_note,
                "advice": advice,
                "kws": extract_zh_keywords(rel_chunk[1], add_synonyms=True)
            })
        if len(found) >= 2:
            break
    if len(found) < 2:
        for pat_name, note_regex, en_regex, advice in PATTERN_RULES:
            if pat_name in seen_names:
                continue
            if re.search(en_regex, sent_en, re.I):
                rel_chunk = chunks[0] if chunks else [sent_en, ""]
                for c in chunks:
                    if re.search(en_regex, c[0], re.I):
                        rel_chunk = c
                        break
                seen_names.add(pat_name)
                found.append({
                    "name": pat_name,
                    "en_anchor": rel_chunk[0],
                    "zh_anchor": rel_chunk[1],
                    "note": combined_note,
                    "advice": advice,
                    "kws": extract_zh_keywords(rel_chunk[1], add_synonyms=True)
                })
            if len(found) >= 2:
                break
    if not found:
        rel_chunk = chunks[0] if chunks else [sent_en, ""]
        found.append({
            "name": "主干切分与语块顺译",
            "en_anchor": rel_chunk[0],
            "zh_anchor": rel_chunk[1],
            "note": combined_note or "把握主谓宾核心主干与修饰语块的顺承关系。",
            "advice": "先抓主句主谓宾主干，再按逻辑顺序衔接状语与定语修饰成分。",
            "kws": extract_zh_keywords(rel_chunk[1], add_synonyms=True)
        })
    return found

def split_chunks(bank_path="jingfan_bank.json", chunks_dir="data/chunks", manifest_path="data/manifest.json"):
    if not os.path.exists(bank_path):
        print(f"Bank file {bank_path} not found.")
        return
    with open(bank_path, "r", encoding="utf-8") as f:
        bank = json.load(f)
    os.makedirs(chunks_dir, exist_ok=True)
    manifest = []
    for item in bank:
        exam = item.get("exam", "英语（二）")
        year = item.get("year")
        exam_slug = "e1" if "一" in exam else "e2"
        chunk_filename = f"{exam_slug}_{year}.json"
        chunk_rel_path = f"data/chunks/{chunk_filename}"
        chunk_full_path = os.path.join(chunks_dir, chunk_filename)
        with open(chunk_full_path, "w", encoding="utf-8") as cf:
            json.dump(item, cf, ensure_ascii=False, separators=(",", ":"))
        manifest.append({
            "exam": exam,
            "year": year,
            "title": item.get("title", "考研英语阅读精翻"),
            "scope": item.get("scope", "Part A · Text 1–4"),
            "chunk": chunk_rel_path,
            "texts": [{"id": t.get("id"), "title": t.get("title"), "genre": t.get("genre", "")} for t in item.get("texts", [])]
        })
    os.makedirs(os.path.dirname(manifest_path) or ".", exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as mf:
        json.dump(manifest, mf, ensure_ascii=False, indent=2)
    print(f"Successfully generated {len(manifest)} chunks and manifest.")

def main():
    import sys
    base = os.path.dirname(os.path.abspath(__file__))
    source_dir = os.environ.get("SOURCE_DIR", "sources")
    jf_files = sorted(glob.glob(os.path.join(source_dir, "*-精翻.json")))
    if "--split" in sys.argv or not jf_files:
        split_chunks(os.path.join(base, "jingfan_bank.json"), os.path.join(base, "data/chunks"), os.path.join(base, "data/manifest.json"))
        return

    all_years = []
    total_sents = 0
    total_vocab = 0
    for jf_path in jf_files:
        with open(jf_path, "r", encoding="utf-8") as f:
            jf_data = json.load(f)
        year = jf_data["year"]
        exam = jf_data.get("exam", "英语（二）")
        for t in jf_data["texts"]:
            tid = t["id"]
            for p_idx, p in enumerate(t["paragraphs"], 1):
                for s_idx, s in enumerate(p["sentences"], 1):
                    exam_tag = "E1" if "一" in exam else "E2"
                    s["id"] = f"{year}-{exam_tag}-T{tid}-P{p_idx}-S{s_idx}"
                    s["code"] = f"P{p_idx}-S{s_idx}"
                    s["vocab"] = match_vocab_in_sentence(s["en"], [], s["chunks"])
                    s["patterns"] = detect_patterns(s["en"], s.get("note", ""), s["chunks"])
                    s["chunk_kws"] = [extract_zh_keywords(c[1], add_synonyms=True) for c in s["chunks"]]
                    total_sents += 1
                    total_vocab += len(s["vocab"])
        jf_data["sources"] = [{
            "label": "全国硕士研究生招生考试历年公开试题及选文研读",
            "url": "https://www.chsi.com.cn/"
        }]
        jf_data["source_note"] = f"本年度收录全国硕士研究生招生考试{exam} Section II Reading Comprehension Part A（Text 1–4，第 21–40 题）公开试题文本。逐句语块切分、核心词汇标注与解析由研读团队独立梳理与交叉校准，仅供学术探讨与英语综合应用能力训练自测，严禁用于任何商业牟利。"
        all_years.append(jf_data)

    out_json = os.path.join(base, "jingfan_bank.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(all_years, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(base, "data.js"), "w", encoding="utf-8") as f:
        f.write("window.KAOYAN_JINGFAN_BANK = ")
        json.dump(all_years, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"Built data.js & jingfan_bank.json: {len(all_years)} years, {total_sents} sentences, {total_vocab} sentence-vocab items.")
    split_chunks(out_json, os.path.join(base, "data/chunks"), os.path.join(base, "data/manifest.json"))

if __name__ == "__main__":
    main()
