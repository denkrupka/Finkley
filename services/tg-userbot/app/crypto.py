"""AES-256-GCM encrypt/decrypt for Telethon session strings + phone_code_hash.

Использует отдельный TG_SECRETS_KEY (не SECRETS_ENCRYPTION_KEY от wFirma) —
domain separation, компрометация одного модуля не утечёт другие секреты.

Формат шифротекста (base64):
    [12 bytes nonce][N bytes ciphertext + 16 bytes auth tag]
"""
import base64
import os
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import get_settings


@lru_cache
def _aesgcm() -> AESGCM:
    key_b64 = get_settings().TG_SECRETS_KEY
    key = base64.b64decode(key_b64)
    if len(key) != 32:
        raise ValueError(f"TG_SECRETS_KEY must decode to 32 bytes, got {len(key)}")
    return AESGCM(key)


def encrypt(plain: str) -> str:
    nonce = os.urandom(12)
    ct = _aesgcm().encrypt(nonce, plain.encode("utf-8"), None)
    return base64.b64encode(nonce + ct).decode("ascii")


def decrypt(encoded: str) -> str:
    raw = base64.b64decode(encoded)
    nonce, ct = raw[:12], raw[12:]
    return _aesgcm().decrypt(nonce, ct, None).decode("utf-8")
