"""Pipeline defaults. A vocab row's ``voice`` / ``strategy`` columns override these.

Chosen from the bake-off (plan step 8): every item sounded right in both voices
with both strategies, and punctuated vs carrier was indistinguishable by ear.
Punctuated wins on simplicity: no cut, so no word-timing step that can fail.
Carrier stays available as a per-word override.

Plain strings with no imports, so every module can use them; tests check they
are valid voice / strategy names.
"""

DEFAULT_VOICE = "nestoras"
DEFAULT_STRATEGY = "punctuated"
