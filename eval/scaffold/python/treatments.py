"""Treatment loader for comet skill benchmark experiments."""

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from scaffold.python.skill_parser import load_skill_variant, skill_config
from scaffold.python.paths import EVAL_ROOT, get_skills_dir, get_treatments_dir

# Only comet-relevant categories
TREATMENT_CATEGORIES = {
    "common",
    "comet",
}


@dataclass
class TreatmentConfig:
    name: str
    description: str
    claude_md: str = ""
    skills: list[dict[str, Any]] = field(default_factory=list)
    noise_tasks: list[str] = field(default_factory=list)


@dataclass
class SkillSource:
    name: str
    source_type: str
    path: str | None = None
    hash: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


def _add_language_suffix(content: str, lang: str) -> str:
    suffix = "(Python)" if lang == "py" else "(TypeScript)"
    return re.sub(
        r'^(description: "?)(.+?)("?)$',
        rf"\1\2 {suffix}\3",
        content,
        count=1,
        flags=re.MULTILINE,
    )


def _filter_related_skills(sections: list[str]) -> list[str]:
    return [s for s in sections if s and "<related_skills>" not in s]


def _find_skill_md(path: Path) -> Path:
    if path.is_file():
        if path.name != "SKILL.md":
            raise FileNotFoundError(f"Expected SKILL.md file, got: {path}")
        return path
    skill_md = path / "SKILL.md"
    if not skill_md.exists():
        raise FileNotFoundError(f"SKILL.md not found in {path}")
    return skill_md


def _hash_skill_dir(skill_path: Path) -> str:
    if skill_path.is_file():
        data = skill_path.read_bytes()
        return "sha256:" + hashlib.sha256(data).hexdigest()
    digest = hashlib.sha256()
    for item in sorted(skill_path.rglob("*")):
        if item.is_file():
            digest.update(str(item.relative_to(skill_path)).replace("\\", "/").encode())
            digest.update(item.read_bytes())
    return "sha256:" + digest.hexdigest()


def _build_path_skill_config(name: str, path_value: str) -> dict:
    raw_path = Path(path_value).expanduser()
    source_path = raw_path.resolve()
    if not source_path.exists() and not raw_path.is_absolute():
        source_path = (EVAL_ROOT / raw_path).resolve()
    skill_md = _find_skill_md(source_path)
    skill_dir = skill_md.parent
    scripts_dir = skill_dir / "scripts"
    content = skill_md.read_text(encoding="utf-8")
    cfg = skill_config([content], scripts_dir if scripts_dir.exists() else None, None)
    cfg["source_dir"] = skill_dir
    cfg["source"] = {
        "name": name,
        "source_type": "path",
        "path": str(source_path),
        "hash": _hash_skill_dir(skill_dir),
    }
    return cfg


def _build_skill_config(
    skill_dir: str,
    variant: str = "all",
    suffix: bool = False,
    include_related: bool = False,
    noise: bool = False,
    base: str = "benchmarks",
    included_sections: list[str] | None = None,
    extra_sections: list[str] | None = None,
    section_overrides: dict[str, str] | None = None,
) -> dict:
    if base == "main":
        skill_path = get_skills_dir() / "main" / skill_dir
    else:
        skill_path = get_skills_dir() / "benchmarks" / skill_dir

    if noise:
        noise_path = get_skills_dir() / "noise" / skill_dir
        for filename in ["SKILL.md", "skill.md"]:
            skill_md = noise_path / filename
            if skill_md.exists():
                return skill_config([skill_md.read_text(encoding="utf-8")], None, None)
        return None

    variant_path = skill_path / f"skill_{variant}.md" if variant else skill_path / "skill.md"
    if variant and not variant_path.exists():
        resolved_md_path = None
        for filename in ["SKILL.md", "skill.md"]:
            if (skill_path / filename).exists():
                resolved_md_path = skill_path / filename
                break
        if resolved_md_path is None:
            raise FileNotFoundError(f"No skill file found in {skill_path}")
        from scaffold.python.skill_parser import get_section_list, parse_skill_md
        sections = parse_skill_md(resolved_md_path)
        all_sections = get_section_list(resolved_md_path)
        scripts_dir = skill_path / "scripts"
        skill = {
            "sections": sections,
            "all": all_sections,
            "scripts_dir": scripts_dir if scripts_dir.exists() else None,
            "script_filter": None,
        }
    else:
        resolved_md_path = variant_path
        skill = load_skill_variant(skill_path, variant)

    if included_sections:
        sections = []
        for section_name in included_sections:
            if section_overrides and section_name in section_overrides:
                sections.append(section_overrides[section_name])
            elif section_name in skill["sections"]:
                sections.append(skill["sections"][section_name])
        if not include_related:
            sections = _filter_related_skills(sections)
        if extra_sections:
            sections = sections + extra_sections
        content = "\n\n".join(sections)
    elif section_overrides:
        sections = []
        for section_name, content in skill["sections"].items():
            if section_name in section_overrides:
                sections.append(section_overrides[section_name])
            else:
                sections.append(content)
        if not include_related:
            sections = _filter_related_skills(sections)
        if extra_sections:
            sections = sections + extra_sections
        content = "\n\n".join(sections)
    else:
        content = resolved_md_path.read_text(encoding="utf-8")
        if not include_related:
            content = re.sub(
                r"<related_skills>.*?</related_skills>\s*",
                "",
                content,
                flags=re.DOTALL,
            )
        if extra_sections:
            content = content + "\n\n" + "\n\n".join(extra_sections)

    if suffix and variant in ("py", "ts"):
        content = _add_language_suffix(content, variant)

    cfg = skill_config([content], skill["scripts_dir"], skill.get("script_filter"))
    cfg["source_dir"] = skill_path
    return cfg


def build_treatment_skills(skill_configs: list[dict[str, Any]]) -> dict[str, dict]:
    skills = {}
    for cfg in skill_configs:
        name = cfg.get("name")
        skill_dir = cfg.get("skill")
        if not name and skill_dir:
            name = skill_dir.replace("_", "-")
        if cfg.get("source") == "path":
            skills[name] = _build_path_skill_config(name, cfg["path"])
            continue
        if "content" in cfg:
            skills[name] = skill_config([cfg["content"]], None, None)
            continue
        variant = cfg.get("variant", "all")
        suffix = cfg.get("suffix", False)
        include_related = cfg.get("include_related", False)
        noise = cfg.get("noise", False)
        base = cfg.get("base", "benchmarks")
        included_sections = cfg.get("included_sections")
        extra_sections = cfg.get("extra_sections")
        section_overrides = cfg.get("section_overrides")
        skill_cfg = _build_skill_config(
            skill_dir=skill_dir, variant=variant, suffix=suffix,
            include_related=include_related, noise=noise, base=base,
            included_sections=included_sections, extra_sections=extra_sections,
            section_overrides=section_overrides,
        )
        if skill_cfg:
            skills[name] = skill_cfg
    return skills


def load_treatments_yaml(path: Path) -> dict[str, TreatmentConfig]:
    if not path.exists():
        raise FileNotFoundError(f"Treatments file not found: {path}")
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    treatments = {}
    for name, cfg in data.items():
        if name.startswith("_"):
            continue
        treatments[name] = TreatmentConfig(
            name=name,
            description=cfg.get("description", ""),
            claude_md=cfg.get("claude_md", ""),
            skills=cfg.get("skills", []),
            noise_tasks=cfg.get("noise_tasks", []),
        )
    return treatments


def load_treatments() -> dict[str, TreatmentConfig]:
    treatments_folder = get_treatments_dir()
    if not treatments_folder.exists():
        return {}
    treatments = {}
    for category in sorted(treatments_folder.iterdir()):
        if not category.is_dir():
            continue
        if category.name not in TREATMENT_CATEGORIES:
            continue
        for yaml_file in sorted(category.glob("*.yaml")):
            category_treatments = load_treatments_yaml(yaml_file)
            treatments.update(category_treatments)
    return treatments


def load_treatment(name: str):
    from scaffold import Treatment
    configs = load_treatments()
    if name not in configs:
        raise KeyError(f"Treatment not found: {name}. Available: {list(configs.keys())}")
    cfg = configs[name]
    skills = build_treatment_skills(cfg.skills) if cfg.skills else {}
    return Treatment(
        description=cfg.description,
        skills=skills,
        claude_md=cfg.claude_md if cfg.claude_md else None,
    )


def list_treatments() -> list[str]:
    return sorted(load_treatments().keys())
