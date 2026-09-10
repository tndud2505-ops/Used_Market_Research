function cleanQuery(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function uniqueQueries(values, maximum) {
  const seen = new Set();
  const queries = [];
  for (const value of values) {
    const query = cleanQuery(value);
    const key = query.toLocaleLowerCase("en-US");
    if (!query || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
    if (queries.length >= maximum) break;
  }
  return queries;
}

function combinedProductSpec(product) {
  return { ...(product?.spec || {}), ...(product?.browse_facets || {}) };
}

function compactProductText(value) {
  return cleanQuery(value).toUpperCase().replace(/[^0-9A-Z가-힣]+/gu, "");
}

function regexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function exactModelPattern(value) {
  const separated = cleanQuery(value).toUpperCase()
    .replace(/([A-Z])(\d)/gu, "$1 $2")
    .replace(/(\d)([A-Z])/gu, "$1 $2");
  const chunks = separated.match(/[0-9A-Z가-힣]+/gu) || [];
  if (!chunks.length) return null;
  return new RegExp(`(?:^|[^0-9A-Z])${chunks.map(regexEscape).join("[-\\s._/~]*")}(?![0-9A-Z])`, "iu");
}

export function pcProductQueryVariants(product, { sourceKey = "", maximum = 4 } = {}) {
  const limit = Math.min(6, Math.max(1, Number(maximum) || 4));
  const spec = combinedProductSpec(product);
  const category = String(product?.category || "").toUpperCase();
  const manufacturer = String(product?.manufacturer || "").trim();
  const name = cleanQuery(product?.name);
  const aliases = Array.isArray(product?.aliases) ? product.aliases : [];
  if (String(sourceKey).toLowerCase() === "ebay") {
    return uniqueQueries([name, ...aliases], limit);
  }
  if (category === "CPU") {
    const cpuModel = cleanQuery(spec.cpu_model || aliases.at(-1));
    const ryzen = name.match(/(?:AMD\s+)?RYZEN\s+([3579])\s+(.+)$/iu);
    if (manufacturer.toUpperCase() === "AMD" && ryzen) {
      return uniqueQueries([
        `라이젠 ${ryzen[1]} ${cpuModel || ryzen[2]}`,
        `Ryzen ${ryzen[1]} ${cpuModel || ryzen[2]}`,
        `라이젠${ryzen[1]} ${cpuModel || ryzen[2]}`,
        `AMD Ryzen ${ryzen[1]} ${cpuModel || ryzen[2]}`,
      ], limit);
    }
    if (/ULTRA/iu.test(cpuModel)) {
      const ultraModel = cpuModel.replace(/^CORE\s+/iu, "");
      return uniqueQueries([
        ultraModel, `Core ${ultraModel}`, `인텔 코어 ${ultraModel.replace(/^ULTRA/iu, "울트라")}`, name,
      ], limit);
    }
    if (/^I[3579]\s*-/iu.test(cpuModel)) {
      const spaced = cpuModel.replace(/\s*-\s*/u, " ");
      return uniqueQueries([cpuModel, spaced, `인텔 ${spaced}`, name], limit);
    }
  }
  if (category === "GPU") {
    const gpuModel = cleanQuery(spec.gpu_model || aliases[0]);
    const compactModel = gpuModel.replace(/\s+/gu, "");
    const localized = manufacturer.toUpperCase() === "NVIDIA"
      ? `지포스 ${gpuModel}`
      : manufacturer.toUpperCase() === "AMD"
        ? `라데온 ${gpuModel}`
        : manufacturer.toUpperCase() === "INTEL"
          ? `인텔 아크 ${gpuModel.replace(/^ARC\s*/iu, "")}`
          : `${manufacturer} ${gpuModel}`;
    return uniqueQueries([gpuModel, compactModel, localized, name], limit);
  }
  return uniqueQueries([...aliases, name], limit);
}

export function strongProductTitleMatch(product, value) {
  const text = cleanQuery(value);
  const spec = combinedProductSpec(product);
  const category = String(product?.category || "").toUpperCase();
  const manufacturer = String(product?.manufacturer || "").toUpperCase();
  const model = cleanQuery(spec.cpu_model || spec.gpu_model || spec.exact_model || product?.aliases?.[0]);
  const compactModel = compactProductText(model);
  const exactPattern = exactModelPattern(model);
  if (compactModel.length < 3 || !exactPattern?.test(text)) return false;

  if (category === "CPU") {
    const compactUpper = compactProductText(text);
    const compactTarget = compactProductText(model);
    const targetIndex = compactUpper.indexOf(compactTarget);
    const trailing = targetIndex >= 0 ? compactUpper.slice(targetIndex + compactTarget.length) : "";
    const intelModel = model.match(/^I[3579]\s*-?\s*\d{4,5}([A-Z]{0,3})$/iu);
    const amdModel = model.match(/^(?:PRO\s*)?\d{4,5}([A-Z0-9]{0,4})$/iu);

    if (intelModel && !intelModel[1] && /^(?:KF|KS|HX|HK|TE|F|K|T|U|H|P|Y)/iu.test(trailing)) return false;
    if (amdModel && !amdModel[1] && /^(?:X3D|XT|GE|HS|HX|X|G|U|H)/iu.test(trailing)) return false;
    if (amdModel?.[1]?.toUpperCase() === "X" && /^(?:3D|T)/iu.test(trailing)) return false;

    if (manufacturer === "AMD" && /^\d/u.test(model)) {
      if (new RegExp(`LGA\\s*${regexEscape(model)}`, "iu").test(text)) return false;
      return /(?:라이젠|RYZEN|\bAMD\b|\bCPU\b|프로세서)/iu.test(text);
    }
    return true;
  }

  if (category === "GPU") {
    const compactUpper = compactProductText(text);
    const compactTarget = compactProductText(model);
    const targetIndex = compactUpper.indexOf(compactTarget);
    const trailing = targetIndex >= 0 ? compactUpper.slice(targetIndex + compactTarget.length) : "";
    const gpuModel = model.match(/^(?:GEFORCE\s+|RADEON\s+)?(RTX|GTX|GT|RX|ARC)\s*([A-Z]?\d{3,4})(?:\s*(TI|SUPER|XT|XTX))?$/iu);
    if (gpuModel && !gpuModel[3] && /^(?:SUPER|XTX|TI|XT)/iu.test(trailing)) return false;
    if (gpuModel?.[3]?.toUpperCase() === "TI" && /^SUPER/iu.test(trailing)) return false;
    if (gpuModel?.[3]?.toUpperCase() === "XT" && /^X/iu.test(trailing)) return false;
    if (gpuModel?.[1]?.toUpperCase() === "RX" && /^\d{3}$/u.test(gpuModel[2])) {
      return /(?:라데온|RADEON|그래픽(?:카드)?|\bGPU\b|\bVGA\b|비디오카드|\bPC\b|본체|\d+\s*(?:GB|기가)|GDDR)/iu.test(text);
    }
  }
  return true;
}
