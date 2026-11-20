# make_fixtures.jl
#
# Regenerates the fixtures of the reader's specification of the Pedimap input file
# (pedimap-input-file-reader-spec.md, beside this script):
#
#   fixtures/input/pm_small.dat, pm_small.map      the small simulated data set (Binko.Simulate, fixed seeds)
#   fixtures/binko_legacy.ped                      written by Binko's legacy writer (Markers.write_pedimap)
#   fixtures/binko_ibd.ped                         written by Binko's IBD writer (IBD.write_pedimap_ibd)
#   fixtures/flexqtl_routeB_sim_small.ped          FlexQTL 0.99130's file of the run sim_small_ibd, decompressed, with the
#                                                  contact lines of its head replaced by one placeholder comment line
#   fixtures/<name>.expected.json                  the expected parsed content of each of the three
#
# Run from the directory that holds pedimap2-reader-spec:
#
#   julia +1.11.9 --project=<path to a Binko.jl checkout> pedimap2-reader-spec/make_fixtures.jl
#
# The project given with --project is a checkout of Binko.jl; nothing is written into it. The script reads, from that
# checkout, two files FlexQTL 0.99130 wrote from simulated data (test/data/sim/flexqtl/sim_small_ibd and
# p43_sim_deep_ibd_pos) and the parameter template Binko.Simulate fills in (written to a temporary directory only).
#
# The expected JSON of the two Binko fixtures is built from the data the writers were given (the pedigree, the data set,
# the map, the allele and code matrices, the IBD result), not from the files. The expected JSON of the FlexQTL fixture is
# built by the small reader of this script (`read_pedimap`), since no in-memory source exists; its parts are cross-checked
# against Binko's own readers and against the simulated input files of that run. The script ends with a self-check: every
# fixture is read again with `read_pedimap` and compared with its expected JSON, the probabilities of every individual
# are summed per homologue, and the Binko IBD fixture is read once more in the form Binko wrote before its commit 955aefa
# (without the pedigree rows of the dummy founders).

using Random
using SHA
using JSON3
using CodecZlib
using Binko

const Sim = Binko.Simulate
const BIO = Binko.InputOutput
const Mk = Binko.Markers
const Pd = Binko.Pedigree
const Ds = Binko.Descent
const IBD = Binko.IBD

const HERE = @__DIR__
const FIX = joinpath(HERE, "fixtures")
const REPO = pkgdir(Binko)
const FLEXQTL_SMALL = joinpath(REPO, "test", "data", "sim", "flexqtl", "sim_small_ibd")
const FLEXQTL_DEEP = joinpath(REPO, "test", "data", "sim", "flexqtl", "p43_sim_deep_ibd_pos")
const SIM_SMALL = joinpath(REPO, "test", "data", "sim", "sim_small")
const TEMPLATE = joinpath(REPO, "test", "data", "FlexQTL", "flexqtl_templateQTL.par")
const EXPECTED_FORMAT = "pedimap2-reader-spec/expected-content/1"

# Seeds and settings of the simulated set and of the two Binko runs (all fixed: regenerating gives the same bytes)
const PEDIGREE_SEED = 24            # one individual with only its second parent known and one with only its first
const SIMULATION_SEED = 20261119
const PHASE_SEEDS = (11, 12)        # the descent chain behind the legacy file's phases: start, sweeps
const IBD_SEED = 20261119
const IBD_POSITIONS = ["100.05", "100.20", "300.30"]    # chromosome x 100 + Morgan: 5 cM and 20 cM of group 1, 30 cM of group 3
const FIXED_TIMESTAMP = "fixture (a run writes its date here)"
# The line that stands, in the FlexQTL fixture, for the contact lines of FlexQTL's head (the project lead's decision of 2026-11-19)
const CONTACT_PLACEHOLDER = "; [placeholder of pedimap2-reader-spec] FlexQTL 0.99130 writes three contact lines at this place, for Pedimap's author and its own; they are left out of this fixture"

# ------------------------------------------------------------------------------------------------ JSON, written by hand
# An object is an ordered vector of pairs, an array a vector, and a scalar a String, an Int, a Float64 or `nothing`.
# The layout keeps one individual, one marker and one row per line; `JSON3.read` reads the result back in the self-check.

const Obj = Vector{Pair{String,Any}}
obj(pairs::Pair...) = Obj([String(k) => v for (k, v) in pairs])
isobj(x) = x isa Obj
iscontainer(x) = x isa AbstractVector
children(x) = isobj(x) ? (e.second for e in x) : x
depth(x) = iscontainer(x) ? (isempty(x) ? 1 : 1 + maximum(depth(e) for e in children(x))) : 0

function emit_inline(io::IO, x)
    if !iscontainer(x)
        print(io, JSON3.write(x))
    elseif isobj(x)
        print(io, "{")
        for (j, e) in enumerate(x)
            j > 1 && print(io, ", ")
            print(io, JSON3.write(e.first), ": "); emit_inline(io, e.second)
        end
        print(io, "}")
    else
        print(io, "[")
        for (j, e) in enumerate(x)
            j > 1 && print(io, ", ")
            emit_inline(io, e)
        end
        print(io, "]")
    end
    return nothing
end

function emit(io::IO, x, indent::Int = 0)
    if !iscontainer(x) || depth(x) <= 1 || (isobj(x) && depth(x) == 2)
        emit_inline(io, x)
    else
        pad = "  "^(indent + 1)
        print(io, isobj(x) ? "{\n" : "[\n")
        for (j, e) in enumerate(x)
            print(io, pad)
            if isobj(x)
                print(io, JSON3.write(e.first), ": "); emit(io, e.second, indent + 1)
            else
                emit(io, e, indent + 1)
            end
            print(io, j < length(x) ? ",\n" : "\n")
        end
        print(io, "  "^indent, isobj(x) ? "}" : "]")
    end
    return nothing
end

function write_json(path::AbstractString, x)
    open(path, "w") do io
        emit(io, x); print(io, "\n")
    end
    return path
end

"Objects as `Dict`, arrays as `Vector{Any}`: the form in which a parsed fixture and an expected JSON are compared."
plain(x::Obj) = Dict{String,Any}(e.first => plain(e.second) for e in x)
plain(x::JSON3.Object) = Dict{String,Any}(String(k) => plain(v) for (k, v) in pairs(x))
plain(x::Union{AbstractVector,JSON3.Array}) = Any[plain(e) for e in x]
plain(x::AbstractString) = String(x)
plain(x) = x

"The path of the first difference between two plain values, or `nothing` when they are equal (numbers within 1e-9)."
function difference(a, b, path::String = "")
    if a isa Dict && b isa Dict
        keys(a) == keys(b) || return path * ": keys " * string(sort!(collect(keys(a)))) * " against " * string(sort!(collect(keys(b))))
        for k in sort!(collect(keys(a)))
            d = difference(a[k], b[k], path * "/" * k); d === nothing || return d
        end
        return nothing
    elseif a isa Vector && b isa Vector
        length(a) == length(b) || return path * ": lengths $(length(a)) against $(length(b))"
        for j in eachindex(a)
            d = difference(a[j], b[j], path * "/" * string(j)); d === nothing || return d
        end
        return nothing
    elseif a isa Real && b isa Real && !(a isa Bool) && !(b isa Bool)
        return abs(a - b) <= 1e-9 ? nothing : path * ": $a against $b"
    else
        return a == b ? nothing : path * ": $(repr(a)) against $(repr(b))"
    end
end

# ------------------------------------------------------------------------------------------------ the small reader
# A reader of the Pedimap input file as FlexQTL 0.99130 and Binko write it, following the specification beside this
# script (sections 2 to 5 and 7). It is written for these fixtures and for clarity, not for speed.

const SETTING_KEYS = ("POPULATION", "UNKNOWN", "NULLHOMOZ", "CONFIRMEDNULL", "PLOIDY", "NALLELES")

struct PedimapFormatError <: Exception
    msg::String
end
Base.showerror(io::IO, e::PedimapFormatError) = print(io, "PedimapFormatError: ", e.msg)
reject(path, ln, msg) = throw(PedimapFormatError("$(basename(path)), line $ln: $msg"))

"""
    read_pedimap(path) -> (content, aux)

Parse a Pedimap input file. `content` is the parsed content in the layout of the expected JSON files (README.md);
`aux` holds what the self-check needs beyond it: per IBD row and homologue the number of tokens other than the bare
`0` (`rounded`), and the largest number of decimals among the probability tokens (`decimals`).
"""
function read_pedimap(path::AbstractString)
    settings = Dict{String,Any}()
    caption = String[]; pedrows = Tuple{Int,Vector{String}}[]
    groups = Dict{String,Any}[]            # name, markers (name, position, index, allele_names, founder_alleles), ibd
    genotypes = Tuple{Int,String,Vector{Tuple{Int,Vector{String}}}}[]
    ibdsecs = Tuple{Int,Float64,Vector{Tuple{Int,Vector{String}}}}[]
    state = :top; locus = nothing
    for (ln, rawline) in enumerate(split(read(path, String), '\n'))
        line = strip(first(split(rawline, ';'; limit = 2)))          # a `;` starts a comment that runs to the end of the line
        isempty(line) && continue
        tok = String.(split(line)); key = uppercase(tok[1])
        if state == :caption
            caption = tok; state = :pedigree
        elseif occursin('=', line) && uppercase(strip(first(split(line, '='; limit = 2)))) in SETTING_KEYS
            k = uppercase(strip(first(split(line, '='; limit = 2)))); v = String(strip(split(line, '='; limit = 2)[2]))
            haskey(settings, k) && reject(path, ln, "the setting $k is given twice")
            settings[k] = k == "UNKNOWN" ? String.(split(v)) : k in ("PLOIDY", "NALLELES") ? something(tryparse(Int, v), Some(nothing)) : v
            settings[k] === nothing && reject(path, ln, "$k is not an integer: `$v`")
        elseif key == "PEDIGREE" && length(tok) == 1
            isempty(caption) || reject(path, ln, "a second PEDIGREE section")
            state = :caption
        elseif key == "LINKAGEGROUP"
            length(tok) == 2 || reject(path, ln, "LINKAGEGROUP takes one name")
            push!(groups, Dict{String,Any}("name" => tok[2], "markers" => Dict{String,Any}[], "ibd" => nothing)); state = :group
        elseif key == "MAP" && length(tok) == 1
            state == :group || reject(path, ln, "MAP outside a linkage group")
            state = :map
        elseif key == "LOCUS"
            isempty(groups) && reject(path, ln, "LOCUS before any LINKAGEGROUP")
            length(tok) in (2, 3) || reject(path, ln, "LOCUS takes a name and, optionally, an index in parentheses")
            j = findfirst(mk -> mk["name"] == tok[2], groups[end]["markers"])
            j === nothing && reject(path, ln, "the locus $(tok[2]) is not in the MAP of linkage group $(groups[end]["name"])")
            locus = groups[end]["markers"][j]
            if length(tok) == 3
                mt = match(r"^\((\d+)\)$", tok[3]); mt === nothing && reject(path, ln, "unexpected token `$(tok[3])` after the locus name")
                locus["index"] = parse(Int, mt.captures[1])
            end
            state = :locus
        elseif key == "ALLELENAMES"
            state == :locus || reject(path, ln, "ALLELENAMES outside a LOCUS block")
            locus["allele_names"] = tok[2:end]
        elseif key == "FOUNDERALLELES"
            state == :locus || reject(path, ln, "FOUNDERALLELES outside a LOCUS block")
            locus["founder_alleles"] = tok[2:end]
        elseif key == "IBDPOSITIONS"
            isempty(groups) && reject(path, ln, "IBDPOSITIONS before any LINKAGEGROUP")
            groups[end]["ibd"] === nothing || reject(path, ln, "a second IBDPOSITIONS line in linkage group $(groups[end]["name"])")
            v = [tryparse(Float64, t) for t in tok[2:end]]
            any(isnothing, v) && reject(path, ln, "an IBD position is not a number")
            groups[end]["ibd"] = Float64.(v); state = :group
        elseif key == "ALLELES"
            length(tok) == 2 || reject(path, ln, "ALLELES takes one locus name")
            push!(genotypes, (ln, tok[2], Tuple{Int,Vector{String}}[])); state = :alleles
        elseif key == "IBDPOSITION"
            v = length(tok) == 2 ? tryparse(Float64, tok[2]) : nothing
            v === nothing && reject(path, ln, "IBDPOSITION takes one position")
            push!(ibdsecs, (ln, v, Tuple{Int,Vector{String}}[])); state = :ibd
        elseif state == :pedigree
            push!(pedrows, (ln, tok))
        elseif state == :map
            v = length(tok) == 2 ? tryparse(Float64, tok[2]) : nothing
            v === nothing && reject(path, ln, "a MAP row is a locus name and a position")
            push!(groups[end]["markers"], Dict{String,Any}("name" => tok[1], "position" => v, "index" => nothing, "allele_names" => nothing, "founder_alleles" => nothing))
        elseif state == :alleles
            push!(genotypes[end][3], (ln, tok))
        elseif state == :ibd
            push!(ibdsecs[end][3], (ln, tok))
        else
            reject(path, ln, "unexpected line `$line`")
        end
    end
    # the settings: both writers always write the first five; the fallbacks are the values both always write
    unknown = get(settings, "UNKNOWN", ["*", "-"])
    isempty(unknown) && throw(PedimapFormatError("$(basename(path)): UNKNOWN lists no string"))
    nalleles = get(settings, "NALLELES", nothing)
    get(settings, "PLOIDY", 2) == 2 || throw(PedimapFormatError("$(basename(path)): PLOIDY is $(settings["PLOIDY"]); only 2 is described"))
    confirmednull = get(settings, "CONFIRMEDNULL", "null")
    unk(t) = t in unknown ? nothing : t
    # the pedigree
    length(caption) >= 3 || throw(PedimapFormatError("$(basename(path)): no PEDIGREE caption with a name and two parents"))
    fcol = findfirst(c -> uppercase(c) == "FACTOR0", caption)
    names = String[]; index = Dict{String,Int}(); individuals = Any[]
    for (ln, r) in pedrows
        length(r) == length(caption) || reject(path, ln, "a PEDIGREE row of $(length(r)) fields under a caption of $(length(caption))")
        haskey(index, r[1]) && reject(path, ln, "the individual $(r[1]) has two rows")
        (r[1] in unknown) && reject(path, ln, "an individual is named as the unknown symbol")
        push!(names, r[1]); index[r[1]] = length(names)
        factor0 = fcol === nothing ? nothing : tryparse(Int, r[fcol])
        push!(individuals, obj("name" => r[1], "parent1" => unk(r[2]), "parent2" => unk(r[3]), "factor0" => factor0, "values" => Any[unk(t) for t in r[4:end]]))
    end
    # no individual among its own ancestors
    mark = zeros(Int, length(names))                 # 0 not visited, 1 being visited, 2 done
    function visit(i::Int)
        mark[i] == 2 && return nothing
        mark[i] == 1 && throw(PedimapFormatError("$(basename(path)): $(names[i]) is among its own ancestors"))
        mark[i] = 1
        for p in pedrows[i][2][2:3]
            haskey(index, p) && visit(index[p])
        end
        mark[i] = 2
        return nothing
    end
    foreach(visit, eachindex(names))
    # the founders in the order of the founder alleles: the table's order, a parent without a row placed before the first row that names it
    founders = String[]; norow = String[]
    for (_, r) in pedrows
        for p in (r[2], r[3])
            (p in unknown || haskey(index, p) || p in founders) && continue
            push!(founders, p); push!(norow, p)
        end
        (r[2] in unknown && r[3] in unknown) && push!(founders, r[1])
    end
    # the map and the loci
    marker_group = Dict{String,String}(); allowed = Dict{String,Any}(); lgs = Any[]
    for g in groups
        mks = Any[]
        for mk in g["markers"]
            haskey(marker_group, mk["name"]) && throw(PedimapFormatError("$(basename(path)): the locus $(mk["name"]) is in the map twice"))
            marker_group[mk["name"]] = g["name"]
            allowed[mk["name"]] = mk["allele_names"] === nothing ? nothing : Set(vcat(mk["allele_names"], [confirmednull]))
            fa = mk["founder_alleles"]
            if fa !== nothing
                nalleles === nothing && throw(PedimapFormatError("$(basename(path)): FOUNDERALLELES without NALLELES"))
                length(fa) == nalleles || throw(PedimapFormatError("$(basename(path)): FOUNDERALLELES of $(mk["name"]) lists $(length(fa)) names, NALLELES is $nalleles"))
            end
            push!(mks, obj("name" => mk["name"], "index" => mk["index"], "position_cM" => mk["position"], "allele_names" => mk["allele_names"] === nothing ? nothing : Any[String(a) for a in mk["allele_names"]],
                "founder_alleles" => fa === nothing ? nothing : Any[unk(a) for a in fa]))
        end
        push!(lgs, obj("name" => g["name"], "markers" => mks, "ibd_positions_cM" => g["ibd"] === nothing ? nothing : Any[x for x in g["ibd"]]))
    end
    # the genotype sections
    gsec = Any[]; ngrows = 0
    for (ln, marker, rows) in genotypes
        haskey(marker_group, marker) || reject(path, ln, "ALLELES section of a locus that is not in the map: $marker")
        out = Any[]
        for (rl, r) in rows
            length(r) == 5 || reject(path, rl, "an ALLELES row is a name and two (allele, code) pairs")
            haskey(index, r[1]) || reject(path, rl, "ALLELES row of an individual that is not in the PEDIGREE table: $(r[1])")
            c1 = tryparse(Int, r[3]); c2 = tryparse(Int, r[5])
            (c1 === nothing || c2 === nothing) && reject(path, rl, "an indicator code is not an integer")
            for a in (r[2], r[4])
                (a in unknown || allowed[marker] === nothing || a in allowed[marker]) || reject(path, rl, "the allele `$a` is not on the ALLELENAMES line of $marker")
            end
            push!(out, Any[r[1], unk(r[2]), c1, unk(r[4]), c2])
        end
        ngrows += length(out)
        push!(gsec, obj("marker" => marker, "rows" => out))
    end
    # the IBD sections: assigned to the linkage groups by their order, which is the order of the IBDPOSITIONS lines
    listed = [(g["name"], x) for g in groups if g["ibd"] !== nothing for x in g["ibd"]]
    ibd = nothing; rounded = Vector{Tuple{Int,Int}}[]; decimals = 0; nirows = 0
    if nalleles !== nothing && nalleles > 0
        nalleles == 2 * length(founders) || throw(PedimapFormatError("$(basename(path)): NALLELES is $nalleles, the pedigree has $(length(founders)) founders"))
        length(ibdsecs) == length(listed) || throw(PedimapFormatError("$(basename(path)): $(length(ibdsecs)) IBDPOSITION sections against $(length(listed)) positions on the IBDPOSITIONS lines"))
        secs = Any[]
        for (q, (ln, position, rows)) in enumerate(ibdsecs)
            abs(position - listed[q][2]) < 1e-6 || reject(path, ln, "IBDPOSITION $position where the IBDPOSITIONS lines give $(listed[q][2])")
            out = Any[]; rr = Tuple{Int,Int}[]
            for (rl, r) in rows
                length(r) == 1 + 2nalleles || reject(path, rl, "an IBDPOSITION row of $(length(r) - 1) values, 2 x NALLELES is $(2nalleles)")
                haskey(index, r[1]) || reject(path, rl, "IBDPOSITION row of an individual that is not in the PEDIGREE table: $(r[1])")
                v = [tryparse(Float64, t) for t in r[2:end]]
                any(isnothing, v) && reject(path, rl, "a probability is not a number")
                any(x -> x < 0 || x > 1, v) && reject(path, rl, "a probability outside 0 to 1")
                for t in r[2:end]
                    j = findfirst('.', t); j === nothing || (decimals = max(decimals, length(t) - j))
                end
                push!(rr, (count(!=("0"), r[2:nalleles+1]), count(!=("0"), r[nalleles+2:end])))
                push!(out, obj("name" => r[1], "h1" => Any[x for x in v[1:nalleles]], "h2" => Any[x for x in v[nalleles+1:end]]))
            end
            inrows = Set(r[1] for (_, r) in rows)
            for (pl, pr) in pedrows
                (pr[1] in inrows || (pr[2] in unknown && pr[3] in unknown)) || reject(path, ln, "the section has no row for $(pr[1]), which is not a founder")
            end
            nirows += length(out); push!(rounded, rr)
            push!(secs, obj("linkage_group" => listed[q][1], "position_cM" => position, "rows" => out))
        end
        labels = Any[obj("number" => 2 * f - 2 + h, "founder" => founders[f], "homologue" => h) for f in eachindex(founders) for h in 1:2]
        ibd = obj("nalleles" => nalleles, "founder_alleles" => labels, "positions" => secs)
    else
        isempty(ibdsecs) || throw(PedimapFormatError("$(basename(path)): IBDPOSITION sections without NALLELES"))
    end
    content = obj(
        "format" => EXPECTED_FORMAT,
        "fixture" => basename(path),
        "settings" => obj("POPULATION" => get(settings, "POPULATION", nothing), "UNKNOWN" => Any[u for u in unknown], "NULLHOMOZ" => get(settings, "NULLHOMOZ", "\$"),
            "CONFIRMEDNULL" => get(settings, "CONFIRMEDNULL", "null"), "PLOIDY" => get(settings, "PLOIDY", 2), "NALLELES" => nalleles),
        "pedigree" => obj("caption" => Any[c for c in caption], "columns" => Any[c for c in caption[4:end]], "individuals" => individuals, "parents_without_row" => Any[p for p in norow]),
        "linkage_groups" => lgs,
        "genotypes" => gsec,
        "ibd" => ibd,
        "counts" => obj("individuals" => length(names), "founders" => length(founders), "linkage_groups" => length(lgs), "markers" => length(marker_group),
            "genotype_sections" => length(gsec), "genotype_rows" => ngrows, "ibd_positions" => ibd === nothing ? 0 : length(ibdsecs), "ibd_rows" => nirows))
    return content, (rounded = rounded, decimals = decimals)
end

# ------------------------------------------------------------------------------------------------ the simulated set

"The small simulated set of the two Binko fixtures: 24 individuals, 3 linkage groups, 11 markers, two factors and one trait."
function simulated_set(dir::AbstractString)
    sped = Sim.random_pedigree(MersenneTwister(PEDIGREE_SEED); n_founders = 6, n_generations = 2, n_families = 3, n_offspring = 3, p_single_parent = 0.12)
    map = Sim.LinkageMap(["1", "2", "3"],
        [["M1_001", "M1_002", "M1_003", "M1_004"], ["M2_001", "M2_002", "M2_003", "M2_004"], ["M3_001", "M3_002", "M3_003"]],
        [[0.0, 0.075, 0.2, 0.3125], [0.0, 0.1, 0.2, 0.3], [0.025, 0.15, 0.3]])                         # Morgan
    symbols = [["A", "G"], ["A", "G"], ["A", "G"], ["A", "G"], ["A", "C"], ["C", "T"], ["G", "T"], ["A", "T"], ["98", "102", "110"], ["1", "2", "3", "4"], ["98", "102", "110"]]
    freqs = [[0.5, 0.5], [0.4, 0.6], [0.5, 0.5], [0.3, 0.7], [0.5, 0.5], [0.5, 0.5], [0.4, 0.6], [0.5, 0.5], [0.3, 0.3, 0.4], [0.25, 0.25, 0.25, 0.25], [0.4, 0.3, 0.3]]
    spec = Sim.SimSpec(; name = "pm_small", mu = 10.0, sigma_e = 1.0, sigma_u = 0.0, nuisance_effects = [0.0, 0.5], missing_genotype_rate = 0.08, allele_error_rate = 0.02,
        missing_phenotype_rate = 0.1, trait_name = "y")
    sim = Sim.simulate(MersenneTwister(SIMULATION_SEED), sped, map, Sim.MarkerModel(symbols, freqs), Sim.QTL[], spec; seed = SIMULATION_SEED)
    dat, mapfile, parfile = Sim.write_flexqtl(sim, dir; template = TEMPLATE)
    return dat, mapfile, parfile
end

# ------------------------------------------------------------------------------------------------ expected content from the writers' inputs

token(t::AbstractString) = t == "\$\$" ? "null" : String(t)            # a declared null allele is written `null`
unknown_as_nothing(t::AbstractString) = (t == "-" || t == "--") ? nothing : token(t)

"The probabilities as the IBD writer prints them: normalized, four decimals, the rounding residual on the largest entry."
function printed_probabilities(v::AbstractVector{<:Real}, decimals::Int = 4)
    s = sum(v); w = s > 0 ? collect(v) ./ s : fill(1 / length(v), length(v))
    r = round.(w; digits = decimals); k = argmax(w); r[k] += 1 - sum(r)
    return Any[abs(round(x; digits = decimals)) for x in r]
end

"""
The expected content of a Binko fixture from what the writer was given: the pedigree `ped`, the data set `ds`, the map
`m`, the marker data `md` (its allele lists enter ALLELENAMES), the allele tokens `al` and codes `codes`, and for the
IBD file the result `res`. The pedigree table has a row for every individual of `ped`; the genotype and IBD sections
have rows for the individuals that are not dummy founders.
"""
function expected_binko(fixture, ped, ds, m, md, al, codes; res = nothing)
    n = length(ped); rows = [i for i in 1:n if !ped.dummy[i]]
    rowof = Dict(ds.name[r] => r for r in 1:length(ds))
    pname(q) = q == 0 ? nothing : ped.name[q]
    caption = vcat(["NAME", "PARENT1", "PARENT2", "FACTOR0"], ds.nuisance_names, ds.trait_names)
    individuals = Any[]
    for i in 1:n                         # every individual of the pedigree has a row, the dummy founders included (Binko from commit 955aefa on)
        founder = ped.parent1[i] == 0 && ped.parent2[i] == 0
        hasoffspring = any(j -> ped.parent1[j] == i || ped.parent2[j] == i, 1:n)
        factor0 = founder ? 0 : hasoffspring ? 1 : 2
        r = get(rowof, ped.name[i], 0)
        vals = Any[string(factor0)]
        for j in eachindex(ds.nuisance_names)
            push!(vals, r == 0 ? nothing : unknown_as_nothing(ds.nuisance[r, j]))
        end
        for j in eachindex(ds.trait_names)
            push!(vals, r == 0 ? nothing : unknown_as_nothing(ds.trait_text[r, j]))
        end
        push!(individuals, obj("name" => ped.name[i], "parent1" => pname(ped.parent1[i]), "parent2" => pname(ped.parent2[i]), "factor0" => factor0, "values" => vals))
    end
    founders = [i for i in 1:n if ped.parent1[i] == 0 && ped.parent2[i] == 0]
    res === nothing || founders == res.founders || error("the IBD result's founders are not the pedigree's founders in order")
    k2of = Dict{Int,Int}()
    res === nothing || foreach(((k2, k),) -> k == 0 || (k2of[k] = k2), enumerate(res.source))
    lgs = Any[]; k = 0; gsec = Any[]
    for c in eachindex(m.chromosome)
        mks = Any[]
        for (j, name) in enumerate(m.marker[c])
            k += 1
            an = sort!(unique!(vcat([token(a) for a in ds.alleles[k] if !(a in ("-", "--"))], [token(a) for a in md.alleles[k]])))
            fa = nothing
            if res !== nothing
                F = res.founder_alleles[k2of[k]]
                fa = Any[sum(view(F, :, lab)) == 0 ? nothing : token(md.alleles[k][argmax(view(F, :, lab))]) for lab in 1:res.nf2]
            end
            push!(mks, obj("name" => name, "index" => k, "position_cM" => round(100 * m.position[c][j]; digits = 3), "allele_names" => Any[a for a in an], "founder_alleles" => fa))
            push!(gsec, obj("marker" => name, "rows" => Any[Any[ped.name[i], unknown_as_nothing(al[i, 2k-1]), Int(codes[i, k]), unknown_as_nothing(al[i, 2k]), Int(codes[i, k])] for i in rows]))
        end
        ip = res === nothing ? nothing : Any[round(100 * p.position; digits = 4) for p in res.positions if p.chromosome == c]
        push!(lgs, obj("name" => m.chromosome[c], "markers" => mks, "ibd_positions_cM" => ip))
    end
    ibd = nothing; nirows = 0
    if res !== nothing
        labels = Any[obj("number" => 2 * f - 2 + h, "founder" => ped.name[i], "homologue" => h) for (f, i) in enumerate(res.founders) for h in 1:2]
        secs = Any[]
        for (q, p) in enumerate(res.positions)
            out = Any[obj("name" => ped.name[i], "h1" => printed_probabilities(view(res.hom, :, 1, i, q)), "h2" => printed_probabilities(view(res.hom, :, 2, i, q))) for i in rows]
            nirows += length(out)
            push!(secs, obj("linkage_group" => m.chromosome[p.chromosome], "position_cM" => round(100 * p.position; digits = 4), "rows" => out))
        end
        ibd = obj("nalleles" => res.nf2, "founder_alleles" => labels, "positions" => secs)
    end
    return obj(
        "format" => EXPECTED_FORMAT,
        "fixture" => fixture,
        "settings" => obj("POPULATION" => basename(ds.path), "UNKNOWN" => Any["*", "-"], "NULLHOMOZ" => "\$", "CONFIRMEDNULL" => "null", "PLOIDY" => 2, "NALLELES" => res === nothing ? nothing : res.nf2),
        "pedigree" => obj("caption" => Any[c for c in caption], "columns" => Any[c for c in caption[4:end]], "individuals" => individuals,
            "parents_without_row" => Any[]),
        "linkage_groups" => lgs,
        "genotypes" => gsec,
        "ibd" => ibd,
        "counts" => obj("individuals" => n, "founders" => length(founders), "linkage_groups" => length(lgs), "markers" => k, "genotype_sections" => length(gsec),
            "genotype_rows" => length(rows) * k, "ibd_positions" => res === nothing ? 0 : length(res.positions), "ibd_rows" => nirows))
end

tally(v) = join(["$c: $(count(==(c), v))" for c in sort!(unique(v))], ", ")

"Is `a` the smaller of the two allele names: numerically when every allele name of the locus is an integer, as strings otherwise (the rule of D15)."
function smaller_allele(a::AbstractString, b::AbstractString, names)
    ints = all(x -> tryparse(Int, x) !== nothing, names)
    return ints ? parse(Int, a) < parse(Int, b) : a < b
end

# ------------------------------------------------------------------------------------------------ the two Binko fixtures

function binko_fixtures()
    tmp = mktempdir()
    dat, mapfile, parfile = simulated_set(tmp)
    mkpath(joinpath(FIX, "input"))
    cp(dat, joinpath(FIX, "input", "pm_small.dat"); force = true); cp(mapfile, joinpath(FIX, "input", "pm_small.map"); force = true)
    par = BIO.read_par(parfile); m = BIO.read_map(mapfile)
    ds = BIO.read_dat(dat, par, m)      # warns that the header's second column of each marker is named xx_<marker>: the simulator's header, read by position
    ped = Pd.Ped(ds); md = Mk.MarkerData(ds, m, ped)
    println("simulated set pm_small: ", length(ds), " individuals in the data file, ", count(ped.dummy), " dummy founders added by Binko for single known parents (",
        join(ped.name[ped.dummy], ", "), "), ", length(ped), " individuals in the pedigree, ", length(m.chromosome), " linkage groups, ", Mk.nmarkers(md), " markers")

    # (a) the legacy file: the consistency pass gives the classes, a short descent chain on the edited data the most probable phases
    ed, log = Mk.consistency_pass(md, ped)
    classes = Mk.consistency_codes(md, ped, log)
    state = Ds.DescentState(ed, ped; alpha = 0.005, rng = MersenneTwister(PHASE_SEEDS[1]))
    h = Ds.sweeps(state, 2000; rng = MersenneTwister(PHASE_SEEDS[2]), burnin = 200, thin = 2)
    lp = Ds.locked_phases(h; date = FIXED_TIMESTAMP)
    codes = Mk.pedimap_codes(ped, ed, lp, ped.name, classes)
    al = Mk.pedimap_alleles(ped, ed, ds, lp, codes)
    legacy = joinpath(FIX, "binko_legacy.ped")
    open(legacy, "w") do io
        Mk.write_pedimap(io, ped, ds, ed, al, codes; datafile = basename(ds.path), generator = "Binko (Markers.write_pedimap), fixture of pedimap2-reader-spec", timestamp = FIXED_TIMESTAMP)
    end
    write_json(legacy[1:end-4] * ".expected.json", expected_binko(basename(legacy), ped, ds, m, ed, al, codes))
    visible = [i for i in 1:length(ped) if !ped.dummy[i]]
    println("binko_legacy.ped: consistency classes ", tally(vec(classes[visible, :])), "; indicator codes written ", tally(vec(codes[visible, :])))

    # (b) the IBD file: the steps of Binko.run_ibd, with a fixed time stamp in place of the clock's
    positions = IBD.parse_fixqtlpos(IBD_POSITIONS, m)
    res, hs, _, _ = IBD.run_ibd_chains(md, ped, positions; chains = 2, sweeps = 1000, burnin = 100, thin = 1, seed = IBD_SEED, anchor = 0)
    ial, icodes = IBD.posterior_pedimap_alleles(ped, md, hs, res.source)
    ibdfile = joinpath(FIX, "binko_ibd.ped")
    open(ibdfile, "w") do io
        IBD.write_pedimap_ibd(io, ped, ds, md, res, ial, icodes; datafile = basename(ds.path), generator = "Binko IBD mode (IBD.write_pedimap_ibd), fixture of pedimap2-reader-spec",
            timestamp = FIXED_TIMESTAMP)
    end
    expected = expected_binko(basename(ibdfile), ped, ds, m, md, ial, icodes; res = res)
    write_json(ibdfile[1:end-4] * ".expected.json", expected)
    println("binko_ibd.ped: ", res.info["chains"], " chains of ", res.info["sweeps"], " sweeps after ", res.info["burnin"], " of burn-in, tempered ", res.info["tempered"], ", anchorMarker ",
        res.info["anchor"], "; NALLELES ", res.nf2, "; indicator codes written ", tally(vec(icodes[visible, :])))
    # D15 on the fixture, from the data: haplotype 2f - 1 carries the founder's smaller allele at its first heterozygous marker of the group
    holds = 0; total = 0; k0 = 0
    for c in eachindex(m.chromosome)
        ks = k0+1:k0+length(m.marker[c]); k0 = last(ks)
        for (f, i) in enumerate(res.founders)
            k = findfirst(k -> Mk.heterozygous(md, i, k), ks); k === nothing && continue
            k = ks[k]; a = md.alleles[k][md.genotype[i, 2k-1]]; b = md.alleles[k][md.genotype[i, 2k]]
            small = smaller_allele(a, b, md.alleles[k]) ? a : b
            fa = plain(expected)["linkage_groups"][c]["markers"][k-first(ks)+1]["founder_alleles"]
            total += 1; holds += fa[2 * f - 1] == small && fa[2 * f] == (small == a ? b : a)
        end
    end
    println("binko_ibd.ped: FOUNDERALLELES at the founder's first heterozygous marker of the group lists the smaller allele first in ", holds, " of ", total, " founder-groups (from the data given to the writer)")
    content, aux = read_pedimap(ibdfile)
    observe("  observed in binko_ibd.ped", content, aux)
    observe_founders_without_data("  founders without data in binko_ibd.ped", content)
    return nothing
end

# ------------------------------------------------------------------------------------------------ the FlexQTL fixture

gunzip(path::AbstractString) = open(io -> read(GzipDecompressorStream(io)), path)

"What the specification states of the IBD files as observed: each statement is counted here on the parsed file."
function observe(label::AbstractString, content, aux)
    P = plain(content); ind = P["pedigree"]["individuals"]; names = [x["name"] for x in ind]
    index = Dict(nm => i for (i, nm) in enumerate(names))
    N = P["ibd"]["nalleles"]; founders = unique([x["founder"] for x in P["ibd"]["founder_alleles"]])
    fno = Dict(nm => f for (f, nm) in enumerate(founders))
    println(label, ": ", length(names), " individuals, ", length(founders), " founders, NALLELES ", N, ", ", P["counts"]["markers"], " markers, ", P["counts"]["ibd_positions"], " IBD positions")
    # parents precede their offspring; every parent has a row
    println("  parents before offspring in the table: ", all(x -> all(p -> p === nothing || !haskey(index, p) || index[p] < index[x["name"]], (x["parent1"], x["parent2"])), ind),
        "; parents without a row: ", length(P["pedigree"]["parents_without_row"]))
    # FACTOR0 against the pedigree
    isparent = Set(vcat([x["parent1"] for x in ind], [x["parent2"] for x in ind]))
    f0(x) = (x["parent1"] === nothing && x["parent2"] === nothing) ? 0 : (x["name"] in isparent ? 1 : 2)
    println("  FACTOR0 equals 0 founder / 1 with offspring / 2 without in ", count(x -> x["factor0"] == f0(x), ind), " of ", length(ind), " rows; individuals with exactly one parent unknown: ",
        count(x -> (x["parent1"] === nothing) != (x["parent2"] === nothing), ind))
    # the genotype sections
    geno = P["genotypes"]; rows = reduce(vcat, [g["rows"] for g in geno])
    listed = Set(r[1] for r in rows); absent = [nm for nm in names if !(nm in listed)]; present = [nm for nm in names if nm in listed]
    println("  ALLELES sections: every section lists every individual of the table in the table's order: ", all(g -> [r[1] for r in g["rows"]] == names, geno),
        "; every section lists the same ", length(present), " individuals in the table's order: ", all(g -> [r[1] for r in g["rows"]] == present, geno),
        "; individuals of the table in no ALLELES section: ", isempty(absent) ? "none" : join(absent, ", "))
    println("  the two codes of an ALLELES row are equal in ", count(r -> r[3] == r[5], rows), " of ", length(rows), " rows")
    println("  indicator codes (rows): ", tally([r[3] for r in rows]))
    for c in sort!(unique([r[3] for r in rows]))
        rc = [r for r in rows if r[3] == c]
        println("    code ", c, ": both alleles given ", count(r -> r[2] !== nothing && r[4] !== nothing, rc), ", both unknown ", count(r -> r[2] === nothing && r[4] === nothing, rc),
            ", one unknown ", count(r -> (r[2] === nothing) != (r[4] === nothing), rc))
    end
    markers = [(g["name"], mk) for g in P["linkage_groups"] for mk in g["markers"]]
    println("  LOCUS indices are 1, 2, ... in map order: ", [mk["index"] for (_, mk) in markers] == collect(1:length(markers)), "; ALLELES sections in map order: ",
        [g["marker"] for g in geno] == [mk["name"] for (_, mk) in markers])
    grow = Dict((g["marker"], r[1]) => r for g in geno for r in g["rows"])
    # founders' own rows, and the founder alleles against the founders' genotype rows
    secs = P["ibd"]["positions"]; own = 0; ownn = 0
    for s in secs, r in s["rows"]
        f = get(fno, r["name"], 0); f == 0 && continue
        ownn += 1
        own += all(j -> r["h1"][j] == (j == 2 * f - 1 ? 1.0 : 0.0), 1:N) && all(j -> r["h2"][j] == (j == 2 * f ? 1.0 : 0.0), 1:N)
    end
    println("  founder rows with probability 1 on allele 2f - 1 (first block) and 2f (second block), f the founder's rank in the table: ", own, " of ", ownn)
    same = 0; swapped = 0; other = 0; unknownfa = 0
    for (_, mk) in markers, (f, nm) in enumerate(founders)
        haskey(grow, (mk["name"], nm)) || continue
        r = grow[(mk["name"], nm)]; a = mk["founder_alleles"][2 * f - 1]; b = mk["founder_alleles"][2 * f]
        if a === nothing || b === nothing
            unknownfa += 1
        elseif (r[2], r[4]) == (a, b)
            same += 1
        elseif (r[4], r[2]) == (a, b)
            swapped += 1
        else
            other += 1
        end
    end
    println("  FOUNDERALLELES (2f - 1, 2f) against the founder's ALLELES row: the same ordered pair ", same, ", the pair in the other order ", swapped, ", another pair ", other,
        ", founder alleles unknown (-) ", unknownfa)
    # D15: the smaller allele on haplotype 2f - 1 at the anchor marker, read off the file itself. Three candidate anchors: the first marker of the
    # group at which the founder's ALLELES row is heterozygous (any code), the first with code 0 only, and the one nearest the group's IBD position
    descriptions = Dict(:first => "the first marker of the group at which the founder's ALLELES row is heterozygous", :first0 => "the same among rows of code 0 only",
        :nearest => "the marker with a heterozygous ALLELES row nearest the group's single IBD position")
    for rule in (:first, :first0, :nearest)
        holds = 0; total = 0; nowhere = 0
        for g in P["linkage_groups"], (f, nm) in enumerate(founders)
            het = [mk for mk in g["markers"] if haskey(grow, (mk["name"], nm)) &&
                (r = grow[(mk["name"], nm)]; (rule != :first0 || r[3] == 0) && r[2] !== nothing && r[4] !== nothing && r[2] != r[4])]
            if isempty(het)
                nowhere += 1; continue
            end
            ip = g["ibd_positions_cM"]
            if rule == :nearest && (ip === nothing || length(ip) != 1)
                continue
            end
            mk = rule == :nearest ? het[argmin([abs(x["position_cM"] - ip[1]) for x in het])] : het[1]
            r = grow[(mk["name"], nm)]; small = smaller_allele(r[2], r[4], mk["allele_names"]) ? r[2] : r[4]
            total += 1; holds += mk["founder_alleles"][2 * f - 1] == small
        end
        println("  D15, anchor = ", descriptions[rule], ": FOUNDERALLELES 2f - 1 is the smaller allele in ", holds, " of ", total, " founder-groups",
            rule == :first ? " ($nowhere founder-groups heterozygous nowhere)" : "")
    end
    # homologue order: the first block's probability lies on the founder alleles of the first parent's ancestors, the second block's on the second parent's
    anc = Dict{String,Set{Int}}(nm => Set([f]) for (f, nm) in enumerate(founders))
    for x in ind
        if x["parent1"] === nothing && x["parent2"] === nothing
            anc[x["name"]] = Set([fno[x["name"]]])
        else
            anc[x["name"]] = union(get(anc, something(x["parent1"], ""), Set{Int}()), get(anc, something(x["parent2"], ""), Set{Int}()))
        end
    end
    ok = 0; tot = 0; decisive = 0
    for s in secs, r in s["rows"]
        x = ind[index[r["name"]]]; (x["parent1"] === nothing || x["parent2"] === nothing) && continue
        s1 = Set([(j + 1) ÷ 2 for j in 1:N if r["h1"][j] > 0]); s2 = Set([(j + 1) ÷ 2 for j in 1:N if r["h2"][j] > 0])
        a1 = anc[x["parent1"]]; a2 = anc[x["parent2"]]
        tot += 1; ok += issubset(s1, a1) && issubset(s2, a2); decisive += !(issubset(s1, a2) && issubset(s2, a1))
    end
    println("  non-founder rows whose first block lies on the founders behind PARENT1 and second block on those behind PARENT2: ", ok, " of ", tot,
        " (", decisive, " of them would not fit the opposite order)")
    ilisted = Set(r["name"] for s in secs for r in s["rows"]); ipresent = [nm for nm in names if nm in ilisted]
    println("  IBDPOSITION sections: every section lists every individual of the table in the table's order: ", all(s -> [r["name"] for r in s["rows"]] == names, secs),
        "; every section lists the same ", length(ipresent), " individuals in the table's order: ", all(s -> [r["name"] for r in s["rows"]] == ipresent, secs),
        "; individuals of the table in no IBDPOSITION section: ", length(ipresent) == length(names) ? "none" : join([nm for nm in names if !(nm in ilisted)], ", "))
    # allele order in the ALLELES rows: where an IBD position is a marker's, the first allele against the founder allele most probable on the first homologue
    same = 0; swapped = 0; other = 0
    for s in secs, (g, mk) in markers
        (g == s["linkage_group"] && abs(mk["position_cM"] - s["position_cM"]) < 1e-6) || continue
        for r in s["rows"]
            haskey(fno, r["name"]) && continue
            gr = grow[(mk["name"], r["name"])]
            (gr[2] === nothing || gr[4] === nothing || gr[2] == gr[4]) && continue
            j1 = argmax(r["h1"]); j2 = argmax(r["h2"])
            (r["h1"][j1] >= 0.9 && r["h2"][j2] >= 0.9) || continue
            a = mk["founder_alleles"][j1]; b = mk["founder_alleles"][j2]
            (a === nothing || b === nothing || a == b) && continue
            (gr[2], gr[4]) == (a, b) ? (same += 1) : (gr[4], gr[2]) == (a, b) ? (swapped += 1) : (other += 1)
        end
    end
    println("  heterozygous non-founder ALLELES rows at a marker that is an IBD position, both homologues assigned with probability 0.9 or more: first allele on the first homologue ", same,
        ", on the second ", swapped, ", alleles other than the two founder alleles ", other)
    return nothing
end

"""
What a file holds for its founders without data (a founder with a pedigree row, no factor or trait value and no known
allele in any ALLELES row): its rows in the pedigree table, in the ALLELES sections and in the IBDPOSITION sections, its
entries on the FOUNDERALLELES lines, and how the homologue its offspring inherit from it is spread over its two alleles.
"""
function observe_founders_without_data(label::AbstractString, content)
    P = plain(content); ind = P["pedigree"]["individuals"]; geno = P["genotypes"]; secs = P["ibd"]["positions"]; N = P["ibd"]["nalleles"]
    founders = unique([x["founder"] for x in P["ibd"]["founder_alleles"]]); fno = Dict(nm => f for (f, nm) in enumerate(founders))
    grows = Dict{String,Vector{Any}}()
    for g in geno, r in g["rows"]
        push!(get!(grows, r[1], Any[]), r)
    end
    nodata = [x["name"] for x in ind if x["parent1"] === nothing && x["parent2"] === nothing && all(isnothing, x["values"][2:end]) &&
        all(r -> r[2] === nothing && r[4] === nothing, get(grows, x["name"], Any[]))]
    println(label, ": ", length(nodata), " of ", length(founders), " founders (", join(nodata, ", "), ")")
    isempty(nodata) && return nothing
    byname = Dict(x["name"] => x for x in ind)
    println("    pedigree rows: ", length(nodata), ", each with both parents unknown; FACTOR0 ", tally([byname[nm]["factor0"] for nm in nodata]), "; every other column unknown: ",
        all(nm -> all(isnothing, byname[nm]["values"][2:end]), nodata))
    gr = [r for nm in nodata for r in get(grows, nm, Any[])]
    println("    ALLELES rows: ", length(gr), " of ", length(nodata) * length(geno), " (founders x sections)", isempty(gr) ? "" :
        "; both alleles unknown in " * string(count(r -> r[2] === nothing && r[4] === nothing, gr)) * "; codes " * tally([r[3] for r in gr]))
    fa = [mk["founder_alleles"][2 * fno[nm] - 2 + h] for g in P["linkage_groups"] for mk in g["markers"] for nm in nodata for h in 1:2]
    println("    FOUNDERALLELES entries of these founders: ", length(fa), ", unknown (-) ", count(isnothing, fa), ", an allele name ", count(!isnothing, fa))
    ir = [r for s in secs for r in s["rows"] if r["name"] in nodata]
    own = count(r -> (f = fno[r["name"]]; all(j -> r["h1"][j] == (j == 2 * f - 1 ? 1.0 : 0.0), 1:N) && all(j -> r["h2"][j] == (j == 2 * f ? 1.0 : 0.0), 1:N)), ir)
    println("    IBDPOSITION rows: ", length(ir), " of ", length(nodata) * length(secs), " (founders x sections)", isempty(ir) ? "" :
        "; probability 1 on the founder's own first allele (first half) and second allele (second half), 0 elsewhere, in " * string(own))
    # the homologue an offspring inherits from such a founder
    pairs = Tuple{Float64,Float64}[]; elsewhere = 0
    for s in secs, r in s["rows"]
        x = byname[r["name"]]
        for (h, key, parent) in ((1, "h1", x["parent1"]), (2, "h2", x["parent2"]))
            (parent === nothing || !(parent in nodata)) && continue
            f = fno[parent]; push!(pairs, (r[key][2 * f - 1], r[key][2 * f]))
            elsewhere += any(j -> j != 2 * f - 1 && j != 2 * f && r[key][j] > 0, 1:N)
        end
    end
    if !isempty(pairs)
        println("    homologues inherited from these founders (offspring x sections): ", length(pairs), "; probability outside the founder's two alleles in ", elsewhere,
            "; the two alleles' probabilities: both 0.50 in ", count(==((0.5, 0.5)), pairs), ", otherwise the first from ", minimum(first, pairs), " to ", maximum(first, pairs),
            " and their sum from ", round(minimum(sum, pairs); digits = 4), " to ", round(maximum(sum, pairs); digits = 4))
    end
    return nothing
end

"""
The fixture's bytes from FlexQTL's own: the contact lines of the head (the line that introduces them and the comment lines
that follow it, each with a name and an e-mail address) are replaced by the one line `CONTACT_PLACEHOLDER`. Nothing else
changes. Returns the edited bytes and the number of lines replaced.
"""
function without_contact_lines(bytes::Vector{UInt8})
    lines = split(String(copy(bytes)), '\n')
    a = findfirst(l -> startswith(l, "; for further questions"), lines)
    a === nothing && error("the head has no line that introduces contact lines")
    b = a
    while b < length(lines) && startswith(lines[b+1], ";")
        b += 1
    end
    (a <= 10 && b - a == 2 && all(l -> occursin('@', l), lines[a+1:b]) && !occursin('@', lines[a])) || error("the contact lines are not the three lines expected")
    edited = join(vcat(lines[1:a-1], [CONTACT_PLACEHOLDER], lines[b+1:end]), '\n')
    occursin('@', edited) && error("an e-mail address is left in the fixture")
    return Vector{UInt8}(codeunits(edited)), b - a + 1
end

function flexqtl_fixture()
    source = gunzip(joinpath(FLEXQTL_SMALL, "pedimap.ped.gz"))
    manifest = first(l for l in eachline(joinpath(FLEXQTL_SMALL, "MANIFEST.sha256")) if endswith(l, "  pedimap.ped"))
    bytes2hex(sha256(source)) == first(split(manifest)) || error("the decompressed source does not have the SHA-256 of the run's manifest")
    bytes, nreplaced = without_contact_lines(source)
    file = joinpath(FIX, "flexqtl_routeB_sim_small.ped")
    write(file, bytes)
    content, aux = read_pedimap(file)
    write_json(file[1:end-4] * ".expected.json", content)
    println("flexqtl_routeB_sim_small.ped: FlexQTL's file is ", length(source), " bytes, SHA-256 ", bytes2hex(sha256(source)), " as in the run's MANIFEST.sha256; the fixture replaces its ",
        nreplaced, " contact lines by one placeholder line and is ", length(bytes), " bytes, SHA-256 ", bytes2hex(sha256(bytes)))
    srclines = split(String(copy(source)), '\n'); fixlines = split(String(copy(bytes)), '\n')
    a = findfirst(==(CONTACT_PLACEHOLDER), fixlines)
    (count(==(CONTACT_PLACEHOLDER), fixlines) == 1 && fixlines[1:a-1] == srclines[1:a-1] && fixlines[a+1:end] == srclines[a+nreplaced:end]) ||
        error("the fixture differs from FlexQTL's file elsewhere than at the contact lines")
    println("  every other line equals FlexQTL's: ", length(fixlines) - 1, " lines beside the placeholder (line ", a, ")")
    P = plain(content)
    # cross-check 1: the IBD part against Binko's reader of the same file
    rb = IBD.read_pedimap_ibd(file)
    rb.nalleles == P["ibd"]["nalleles"] || error("NALLELES differs from Binko's reader")
    rb.positions == [(s["linkage_group"], s["position_cM"]) for s in P["ibd"]["positions"]] || error("the IBD positions differ from Binko's reader")
    nfa = 0
    for g in P["linkage_groups"], mk in g["markers"]
        rb.founderalleles[mk["name"]] == [something(a, "-") for a in mk["founder_alleles"]] || error("FOUNDERALLELES of $(mk["name"]) differ from Binko's reader")
        nfa += 1
    end
    nrows = 0
    for (q, s) in enumerate(P["ibd"]["positions"])
        length(rb.ibd[q]) == length(s["rows"]) || error("section $q: the number of rows differs from Binko's reader")
        for r in s["rows"]
            rb.ibd[q][r["name"]] == vcat(r["h1"], r["h2"]) || error("section $q, $(r["name"]): the probabilities differ from Binko's reader")
            nrows += 1
        end
    end
    println("  cross-check against Binko.IBD.read_pedimap_ibd: NALLELES, ", length(rb.positions), " positions, ", nfa, " FOUNDERALLELES lines and ", nrows, " probability rows equal")
    # cross-check 2: the pedigree, the trait, the map and the observed genotypes against the simulated input files of the run (sim_small_fq.dat, sim_small.map)
    par = BIO.read_par(joinpath(SIM_SMALL, "sim_small.par")); m = BIO.read_map(joinpath(SIM_SMALL, "sim_small.map")); ds = BIO.read_dat(joinpath(SIM_SMALL, "sim_small_fq.dat"), par, m)
    rowof = Dict(ds.name[r] => r for r in 1:length(ds)); ind = P["pedigree"]["individuals"]
    par0(t) = t == "0" ? nothing : t
    Set(x["name"] for x in ind) == Set(ds.name) || error("the individuals are not those of the data file")
    all(x -> x["parent1"] == par0(ds.parent1[rowof[x["name"]]]) && x["parent2"] == par0(ds.parent2[rowof[x["name"]]]), ind) || error("a parent differs from the data file")
    ycol = findfirst(==("y"), P["pedigree"]["columns"]); gcol = findfirst(==("Gwrite"), P["pedigree"]["columns"])
    all(x -> x["values"][ycol] == unknown_as_nothing(ds.trait_text[rowof[x["name"]], 1]) && x["values"][gcol] == unknown_as_nothing(ds.nuisance[rowof[x["name"]], 1]), ind) ||
        error("a factor or trait value differs from the data file")
    [g["name"] for g in P["linkage_groups"]] == m.chromosome || error("the linkage groups differ from the map file")
    for (c, g) in enumerate(P["linkage_groups"])
        [mk["name"] for mk in g["markers"]] == m.marker[c] || error("the markers of group $(g["name"]) differ from the map file")
        all(abs(mk["position_cM"] - 100 * m.position[c][j]) < 1e-9 for (j, mk) in enumerate(g["markers"])) || error("a position of group $(g["name"]) differs from the map file")
    end
    kof = Dict(nm => k for (k, nm) in enumerate(reduce(vcat, m.marker))); agree = 0; total0 = 0
    for g in P["genotypes"], r in g["rows"]
        r[3] == 0 || continue
        k = kof[g["marker"]]; i = rowof[r[1]]
        total0 += 1; agree += sort([r[2], r[4]]) == sort([BIO.allele_string(ds, i, k, 1), BIO.allele_string(ds, i, k, 2)])
    end
    println("  cross-check against the run's simulated input (sim_small_fq.dat, sim_small.map): ", length(ind), " individuals with parents, factor and trait, ", length(kof),
        " markers with positions; genotype rows of code 0 that hold the data file's two alleles: ", agree, " of ", total0)
    observe("  observed in flexqtl_routeB_sim_small.ped", content, aux)
    observe_founders_without_data("  founders without data in flexqtl_routeB_sim_small.ped", content)
    return nothing
end

"The same observations on FlexQTL's second route B file from simulated data (sim_deep, one position, anchorMarker 1): read, not copied."
function flexqtl_second_file()
    tmp = mktempdir(); file = joinpath(tmp, "p43_sim_deep_ibd_pos.ped")
    write(file, gunzip(joinpath(FLEXQTL_DEEP, "pedimap.ped.gz")))
    content, aux = read_pedimap(file)
    observe("observed in p43_sim_deep_ibd_pos (FlexQTL, sim_deep; read, not a fixture)", content, aux)
    report_sums("  p43_sim_deep_ibd_pos", content, aux)
    return nothing
end

# ------------------------------------------------------------------------------------------------ the self-check

"The tolerance on a homologue's sum: half a unit of the last decimal for each of the `rounded` printed values (specification 5.6)."
sum_tolerance(rounded::Int, decimals::Int) = 0.5 * 10.0^(-decimals) * rounded + 1e-9

function report_sums(label, content, aux)
    P = plain(content); P["ibd"] === nothing && return (0, 0.0)
    nsum = 0; worst = 0.0; within = 0; tightest = 0.0
    for (q, s) in enumerate(P["ibd"]["positions"]), (j, r) in enumerate(s["rows"]), (h, key) in enumerate(("h1", "h2"))
        dev = abs(sum(r[key]) - 1); tol = sum_tolerance(aux.rounded[q][j][h], aux.decimals)
        nsum += 1; worst = max(worst, dev); within += dev <= tol; tightest = max(tightest, dev / tol)
    end
    within == nsum || error("$label: $(nsum - within) homologue sums lie outside the tolerance")
    println(label, ": ", nsum, " homologue sums, all within the tolerance (", aux.decimals, " decimals); the largest |sum - 1| is ", round(worst; sigdigits = 3),
        ", at most ", round(tightest; sigdigits = 3), " of its tolerance; all within 0.05: ", worst <= 0.05)
    return nsum, worst
end

function self_check()
    println("\nself-check")
    for name in ("binko_legacy", "binko_ibd", "flexqtl_routeB_sim_small")
        file = joinpath(FIX, name * ".ped"); json = joinpath(FIX, name * ".expected.json")
        content, aux = read_pedimap(file)
        expected = plain(JSON3.read(read(json, String)))
        d = difference(plain(content), expected)
        d === nothing || error("$name: the parsed fixture differs from its expected JSON at $d")
        c = plain(content)["counts"]
        println(name, ".ped equals ", name, ".expected.json: ", c["individuals"], " individuals, ", c["founders"], " founders, ", c["linkage_groups"], " linkage groups, ", c["markers"], " markers, ",
            c["genotype_rows"], " genotype rows, ", c["ibd_positions"], " IBD positions, ", c["ibd_rows"], " IBD rows (", filesize(file), " and ", filesize(json), " bytes)")
        report_sums("  " * name, content, aux)
    end
    # the form Binko wrote before its commit 955aefa: no pedigree row for a dummy founder, whose name still stands in a parent column
    file = joinpath(FIX, "binko_ibd.ped"); content, _ = read_pedimap(file); P = plain(content)
    inalleles = Set(r[1] for g in P["genotypes"] for r in g["rows"])
    dummies = [x["name"] for x in P["pedigree"]["individuals"] if x["parent1"] === nothing && x["parent2"] === nothing && !(x["name"] in inalleles)]
    lines = split(read(file, String), '\n'); a = findfirst(==("PEDIGREE"), lines); b = findnext(l -> startswith(l, "LINKAGEGROUP"), lines, a)
    keep = [j for j in eachindex(lines) if !(a < j < b && !isempty(split(lines[j])) && first(split(lines[j])) in dummies)]
    old = joinpath(mktempdir(), "binko_ibd_before_955aefa.ped"); write(old, join(lines[keep], '\n'))
    Q = plain(first(read_pedimap(old)))
    (length(lines) - length(keep) == length(dummies) > 0 && Q["pedigree"]["parents_without_row"] == dummies && isempty(P["pedigree"]["parents_without_row"]) &&
        difference(Q["ibd"], P["ibd"]) === nothing && difference(Q["genotypes"], P["genotypes"]) === nothing && difference(Q["linkage_groups"], P["linkage_groups"]) === nothing &&
        Q["counts"]["founders"] == P["counts"]["founders"] && Q["counts"]["individuals"] == P["counts"]["individuals"] - length(dummies)) ||
        error("binko_ibd.ped without the dummy founders' pedigree rows does not read as the same file")
    println("binko_ibd.ped without the pedigree rows of its ", length(dummies), " dummy founders (", join(dummies, ", "), "; the form before Binko's commit 955aefa): the parents without a row are found, and the founder alleles, ",
        "the map, the genotypes and the IBD sections read the same")
    println("self-check passed")
    return nothing
end

function main()
    mkpath(FIX)
    println("Binko.jl ", pkgversion(Binko), " at ", REPO, ", Julia ", VERSION)
    binko_fixtures()
    flexqtl_fixture()
    flexqtl_second_file()
    self_check()
end

main()
