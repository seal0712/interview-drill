"""AI 服務介面。只有兩種接法：
- openai：OpenAI 相容 API（OpenAI、Gemini、DeepSeek、OpenRouter、LM Studio、Ollama 等都走這個）
- anthropic：Anthropic 官方 API（Claude）
"""
import json
import re

# 這些 Claude 模型支援伺服器端備援：被安全機制擋下時，自動改用其他模型完成同一個請求
FALLBACK_MODELS = ("claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5")


class AIError(Exception):
    pass


def chat(cfg, system, turns, max_tokens=16000):
    """system：每次都一樣的長內容（例如審查資料全文），放最前面方便快取；turns：[{role, content}]。
    回傳 (回覆文字, 實際使用的模型名稱)。"""
    if not cfg.get("model"):
        raise AIError("還沒設定 AI 模型，請到「設定」填寫。")
    if cfg.get("provider") == "anthropic":
        return _anthropic(cfg, system, turns, max_tokens)
    return _openai(cfg, system, turns)


def list_models(cfg):
    try:
        if cfg.get("provider") == "anthropic":
            import anthropic
            client = anthropic.Anthropic(api_key=cfg.get("api_key") or None, base_url=cfg.get("base_url") or None, timeout=30)
            return [m.id for m in client.models.list()]
        from openai import OpenAI
        client = OpenAI(base_url=cfg.get("base_url") or None, api_key=cfg.get("api_key") or "not-needed", timeout=30)
        return sorted(m.id for m in client.models.list())
    except Exception as e:
        raise AIError(f"讀不到模型清單：{e}")


def _openai(cfg, system, turns):
    import openai
    client = openai.OpenAI(base_url=cfg.get("base_url") or None, api_key=cfg.get("api_key") or "not-needed",
                           timeout=600, max_retries=2)
    messages = ([{"role": "system", "content": system}] if system else []) + turns
    try:
        r = client.chat.completions.create(model=cfg["model"], messages=messages)
    except openai.AuthenticationError:
        raise AIError("API key 不正確或沒有權限。")
    except openai.NotFoundError:
        raise AIError("找不到這個模型或網址，請確認「API 網址」與「模型名稱」。")
    except openai.RateLimitError:
        raise AIError("呼叫太頻繁或額度用完了，等一下再試。")
    except openai.APIConnectionError:
        raise AIError("連不上 AI 服務。用 LM Studio／Ollama 的話，請確認本機伺服器已經啟動。")
    except openai.APIStatusError as e:
        raise AIError(f"AI 服務回報錯誤（{e.status_code}）：{e.message}")
    text = r.choices[0].message.content or ""
    # 部分本機推理模型（例如 Qwen3）會把思考過程放在 <think> 標籤裡
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    return text, r.model or cfg["model"]


def _anthropic(cfg, system, turns, max_tokens):
    import anthropic
    client = anthropic.Anthropic(api_key=cfg.get("api_key") or None, base_url=cfg.get("base_url") or None, timeout=600)
    kw = dict(model=cfg["model"], max_tokens=max_tokens, messages=turns)
    if system:
        kw["system"] = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
    if cfg.get("effort"):
        kw["output_config"] = {"effort": cfg["effort"]}
    if cfg["model"] in FALLBACK_MODELS:
        kw.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    try:
        r = client.beta.messages.create(**kw)
    except anthropic.AuthenticationError:
        raise AIError("API key 不正確或沒有權限。")
    except anthropic.NotFoundError:
        raise AIError("找不到這個模型，請確認「模型名稱」。")
    except anthropic.RateLimitError:
        raise AIError("呼叫太頻繁或額度用完了，等一下再試。")
    except anthropic.BadRequestError as e:
        raise AIError(f"請求被拒絕：{e.message}")
    except anthropic.APIStatusError as e:
        raise AIError(f"AI 服務回報錯誤（{e.status_code}），稍後再試。")
    except anthropic.APIConnectionError:
        raise AIError("連不上 Anthropic，請確認網路。")
    if r.stop_reason == "refusal":
        raise AIError("模型拒絕處理這次的內容，可以換個說法或換模型再試。")
    if r.stop_reason == "max_tokens":
        raise AIError("回覆太長被截斷了，再試一次。")
    return "".join(b.text for b in r.content if b.type == "text"), r.model


def parse_json(text):
    try:
        return json.loads(text)
    except ValueError:
        pass
    a, b = text.find("{"), text.rfind("}")
    if a >= 0 and b > a:
        try:
            return json.loads(text[a:b + 1])
        except ValueError:
            pass
    raise AIError("AI 回傳的格式跑掉了，再試一次。")
