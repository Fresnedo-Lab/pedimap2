-- docs/pdf-symbols.lua
-- ====================
-- The PDF manual's fonts (DejaVu, docs.yml) have no glyph for a few symbols
-- that the app's buttons show and that the CHANGELOG quotes. In the PDF only,
-- they become words, or are dropped where a button's name follows:
--   ⚙                -> Settings        ("under ⚙." -> "under Settings.")
--   🖼 Export image…  -> Export image…
--   ⓘ About          -> About
-- The Markdown files themselves keep the symbols, as GitHub shows them.

local WORDS = { ["⚙"] = "Settings" }
local DROPPED = { ["🖼"] = true, ["ⓘ"] = true }

-- A dropped symbol standing alone before a button name: remove it and the
-- space after it.
local function drop_symbols(inlines)
  local out = {}
  local i = 1
  while i <= #inlines do
    local el = inlines[i]
    if el.t == "Str" and DROPPED[el.text] then
      if inlines[i + 1] and inlines[i + 1].t == "Space" then i = i + 1 end
    else
      table.insert(out, el)
    end
    i = i + 1
  end
  return out
end

local function replace_words(str)
  local text = str.text
  for symbol, word in pairs(WORDS) do text = text:gsub(symbol, word) end
  for symbol in pairs(DROPPED) do text = text:gsub(symbol, "") end
  if text ~= str.text then return pandoc.Str(text) end
  return nil
end

return { { Inlines = drop_symbols }, { Str = replace_words } }
