#!/usr/bin/env bash
#
# validate-skill.sh - Validate OpenCode skill structure and frontmatter
#
# Usage: validate-skill.sh <skill-dir> [--json|--quiet]
#
# Exit codes:
#   0 = Valid (may have warnings)
#   1 = Error (invalid skill)

set -euo pipefail

# Colors (disabled if not tty)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    YELLOW='\033[0;33m'
    GREEN='\033[0;32m'
    NC='\033[0m'
else
    RED='' YELLOW='' GREEN='' NC=''
fi

# Output mode
JSON_MODE=false
QUIET_MODE=false

# Counters
ERRORS=0
WARNINGS=0

# Results for JSON output
declare -a RESULTS=()

log_error() {
    ((ERRORS++)) || true
    if $JSON_MODE; then
        RESULTS+=("{\"level\":\"error\",\"message\":\"$1\"}")
    elif ! $QUIET_MODE; then
        echo -e "${RED}ERROR${NC}: $1" >&2
    fi
}

log_warning() {
    ((WARNINGS++)) || true
    if $JSON_MODE; then
        RESULTS+=("{\"level\":\"warning\",\"message\":\"$1\"}")
    elif ! $QUIET_MODE; then
        echo -e "${YELLOW}WARN${NC}: $1" >&2
    fi
}

log_ok() {
    if $JSON_MODE; then
        RESULTS+=("{\"level\":\"info\",\"message\":\"$1\"}")
    elif ! $QUIET_MODE; then
        echo -e "${GREEN}OK${NC}: $1"
    fi
}

usage() {
    cat << 'EOF'
Usage: validate-skill.sh <skill-dir> [--json|--quiet]

Options:
  --json   Output results as JSON
  --quiet  Only output exit code

Exit codes:
  0 = Valid (may have warnings)
  1 = Error (invalid)

Examples:
  validate-skill.sh ./my-skill
  validate-skill.sh ./my-skill --json
  validate-skill.sh ./my-skill --quiet && echo "Valid"
EOF
    exit 1
}

# Parse arguments
SKILL_DIR=""
for arg in "$@"; do
    case $arg in
        --json) JSON_MODE=true ;;
        --quiet) QUIET_MODE=true ;;
        -h|--help) usage ;;
        -*) echo "Unknown option: $arg"; usage ;;
        *) SKILL_DIR="$arg" ;;
    esac
done

if [[ -z "$SKILL_DIR" ]]; then
    usage
fi

# Resolve to absolute path
SKILL_DIR="$(cd "$SKILL_DIR" 2>/dev/null && pwd)" || {
    log_error "Directory not found: $SKILL_DIR"
    exit 1
}

SKILL_NAME="$(basename "$SKILL_DIR")"
SKILL_MD="$SKILL_DIR/SKILL.md"

# ── Check SKILL.md exists ──────────────────────────────────────────

if [[ ! -f "$SKILL_MD" ]]; then
    log_error "SKILL.md not found in $SKILL_DIR"
    exit 1
fi

# Read file content
CONTENT="$(cat "$SKILL_MD")"

# ── Check frontmatter exists and starts at line 1 ──────────────────

if [[ ! "$CONTENT" =~ ^--- ]]; then
    log_error "SKILL.md must start with '---' (YAML frontmatter)"
    exit 1
fi

# Extract frontmatter using awk
FRONTMATTER="$(echo "$CONTENT" | awk '/^---$/{if(p){exit}else{p=1;next}}p')"

if [[ -z "$FRONTMATTER" ]]; then
    log_error "Invalid frontmatter format (missing closing '---')"
    exit 1
fi

log_ok "Frontmatter found"

# ── Validate name field ────────────────────────────────────────────

NAME=""
if [[ "$FRONTMATTER" =~ name:[[:space:]]*([^[:space:]]+) ]]; then
    NAME="${BASH_REMATCH[1]}"
    # Remove quotes if present
    NAME="${NAME#\"}"
    NAME="${NAME%\"}"
    NAME="${NAME#\'}"
    NAME="${NAME%\'}"
fi

if [[ -z "$NAME" ]]; then
    log_error "Missing 'name' field in frontmatter"
else
    # Validate name format
    if [[ ! "$NAME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
        log_error "Invalid name format: '$NAME' (must be lowercase alphanumeric with single hyphens)"
    elif [[ "$NAME" != "$SKILL_NAME" ]]; then
        log_error "Name mismatch: frontmatter '$NAME' != directory '$SKILL_NAME'"
    else
        log_ok "Name: $NAME"
    fi

    # Check length
    if [[ ${#NAME} -gt 64 ]]; then
        log_error "Name too long: ${#NAME} chars (max 64)"
    fi
fi

# ── Validate description field ─────────────────────────────────────

DESCRIPTION=""
if [[ "$FRONTMATTER" =~ description:[[:space:]]*(.+) ]]; then
    DESCRIPTION="${BASH_REMATCH[1]}"
    # Take first line for multi-line descriptions
    DESCRIPTION="${DESCRIPTION%%$'\n'*}"
    # Remove quotes if present
    DESCRIPTION="${DESCRIPTION#\"}"
    DESCRIPTION="${DESCRIPTION%\"}"
    DESCRIPTION="${DESCRIPTION#\'}"
    DESCRIPTION="${DESCRIPTION%\'}"
fi

if [[ -z "$DESCRIPTION" ]]; then
    log_error "Missing 'description' field in frontmatter"
else
    log_ok "Description found"

    # Check length
    if [[ ${#DESCRIPTION} -lt 20 ]]; then
        log_warning "Description too short: ${#DESCRIPTION} chars (recommend 50+)"
    elif [[ ${#DESCRIPTION} -gt 1024 ]]; then
        log_error "Description too long: ${#DESCRIPTION} chars (max 1024)"
    fi

    # Check for first person
    if [[ "$DESCRIPTION" =~ ^I[[:space:]] ]] || [[ "$DESCRIPTION" =~ [[:space:]]I[[:space:]] ]]; then
        log_warning "Description uses first person ('I') -- use third person"
    fi

    # Check for activation triggers
    if [[ ! "$DESCRIPTION" =~ [Uu]se[[:space:]]when ]] && [[ ! "$DESCRIPTION" =~ [Uu]se[[:space:]]for ]]; then
        log_warning "Description lacks activation trigger ('Use when...' or 'Use for...')"
    fi
fi

# ── Check for unsupported frontmatter fields ───────────────────────

if echo "$FRONTMATTER" | grep -qE '^allowed-tools:'; then
    log_warning "'allowed-tools' is not an OpenCode feature (Claude Code only). Field will be ignored."
fi

if echo "$FRONTMATTER" | grep -qE '^hooks:'; then
    log_warning "'hooks' is not an OpenCode feature. Field will be ignored."
fi

# ── Check for XML tags in frontmatter ──────────────────────────────

if [[ "$FRONTMATTER" =~ \<[a-zA-Z]+\> ]]; then
    log_error "Frontmatter contains XML tags (use YAML syntax only)"
fi

# ── Check file sizes ───────────────────────────────────────────────

LINE_COUNT="$(wc -l < "$SKILL_MD" | tr -d ' ')"
if [[ "$LINE_COUNT" -gt 500 ]]; then
    log_warning "SKILL.md has $LINE_COUNT lines (recommend < 500, split to references/)"
elif [[ "$LINE_COUNT" -gt 200 ]]; then
    log_ok "SKILL.md: $LINE_COUNT lines (consider splitting if it grows)"
else
    log_ok "SKILL.md: $LINE_COUNT lines"
fi

# Check reference file sizes
if [[ -d "$SKILL_DIR/references" ]]; then
    while IFS= read -r -d '' ref_file; do
        ref_lines="$(wc -l < "$ref_file" | tr -d ' ')"
        ref_name="${ref_file#"$SKILL_DIR/"}"
        if [[ "$ref_lines" -gt 200 ]]; then
            log_warning "$ref_name has $ref_lines lines (recommend < 200)"
        fi
    done < <(find "$SKILL_DIR/references" -name "*.md" -print0 2>/dev/null)
fi

# ── Check internal links ──────────────────────────────────────────

while IFS= read -r link_path; do
    # Skip external links and variable references
    if [[ "$link_path" == http* ]] || [[ "$link_path" == *'$SKILL_DIR'* ]]; then
        continue
    fi
    # Resolve relative to SKILL.md location
    full_path="$SKILL_DIR/$link_path"
    if [[ ! -e "$full_path" ]]; then
        log_error "Broken link: $link_path"
    fi
done < <(sed -n 's/.*\](\([^)]*\)).*/\1/p' "$SKILL_MD" 2>/dev/null || true)

# ── Check scripts are executable ───────────────────────────────────

if [[ -d "$SKILL_DIR/scripts" ]]; then
    while IFS= read -r -d '' script_file; do
        script_name="${script_file#"$SKILL_DIR/"}"
        if [[ ! -x "$script_file" ]]; then
            log_warning "$script_name is not executable (run: chmod +x $script_file)"
        fi
    done < <(find "$SKILL_DIR/scripts" -name "*.sh" -print0 2>/dev/null)
fi

# ── Output JSON if requested ──────────────────────────────────────

if $JSON_MODE; then
    echo "{"
    echo "  \"valid\": $([ $ERRORS -eq 0 ] && echo "true" || echo "false"),"
    echo "  \"errors\": $ERRORS,"
    echo "  \"warnings\": $WARNINGS,"
    echo "  \"results\": ["
    first=true
    for result in "${RESULTS[@]}"; do
        if $first; then
            first=false
        else
            echo ","
        fi
        echo -n "    $result"
    done
    echo ""
    echo "  ]"
    echo "}"
fi

# ── Final summary ─────────────────────────────────────────────────

if ! $JSON_MODE && ! $QUIET_MODE; then
    echo ""
    if [[ $ERRORS -eq 0 && $WARNINGS -eq 0 ]]; then
        echo -e "${GREEN}Skill is valid.${NC}"
    elif [[ $ERRORS -eq 0 ]]; then
        echo -e "${YELLOW}Skill is valid with $WARNINGS warning(s).${NC}"
    else
        echo -e "${RED}Skill has $ERRORS error(s) and $WARNINGS warning(s).${NC}"
    fi
fi

# Exit code
if [[ $ERRORS -gt 0 ]]; then
    exit 1
else
    exit 0
fi
