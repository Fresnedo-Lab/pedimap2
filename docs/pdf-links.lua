-- docs/pdf-links.lua
-- ==================
-- The PDF manual joins the chapters into one document (docs.yml), so a link
-- to another chapter's file must become a link inside the document:
--   03_quickstart.md            -> #chapter-3-quick-start (its first heading)
--   09_faq.md#appendix-a-...    -> #appendix-a-...
-- On GitHub the chapters stay separate files, and the links work as written.
--
-- Two passes, which pandoc 2.9 (Ubuntu 22.04, the CI runner) runs in order:
-- the first finds each chapter's heading, the second rewrites the links.

local files = {
  "01_introduction.md", "02_installation.md", "03_quickstart.md",
  "04_file_formats.md", "05_interface.md", "06_visualization.md",
  "07_data_export.md", "08_advanced.md", "09_faq.md",
}
local chapter_ids = {}

-- Each chapter starts with "# Chapter N — Title".
local function find_chapters(header)
  if header.level ~= 1 then return nil end
  local number = pandoc.utils.stringify(header.content):match("^Chapter (%d+)")
  if number and files[tonumber(number)] then
    chapter_ids[files[tonumber(number)]] = header.identifier
  end
  return nil
end

local function fix_link(link)
  local file, anchor = link.target:match("^(%d%d_[%w_]+%.md)#?(.*)$")
  if not file then return nil end
  if anchor ~= "" then
    link.target = "#" .. anchor
  elseif chapter_ids[file] then
    link.target = "#" .. chapter_ids[file]
  end
  return link
end

return { { Header = find_chapters }, { Link = fix_link } }
