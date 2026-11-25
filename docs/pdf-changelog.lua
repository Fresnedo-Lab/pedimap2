-- docs/pdf-changelog.lua
-- ======================
-- The PDF manual ends with the CHANGELOG (docs.yml). Its preamble has a
-- paragraph for maintainers, about how the release workflow uses the file;
-- the PDF leaves that paragraph out. CHANGELOG.md itself keeps it.

local MAINTAINER_NOTE = "^The release workflow copies the section"

function Para(para)
  if pandoc.utils.stringify(para):match(MAINTAINER_NOTE) then return {} end
  return nil
end
