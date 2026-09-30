"""Rule auto-discovery (plan Section 7.2).

``discover_rules(app.rules)`` imports every module of the package and returns
``{rule.name: RuleClass}``. The engine never imports or names a specific rule:
adding a rule means adding one file to ``app/rules/``.
"""

from __future__ import annotations

import importlib
import inspect
import logging
import pkgutil
from types import ModuleType

from app.engine.base import FraudRule

logger = logging.getLogger(__name__)

__all__ = ["discover_rules", "DEFAULT_RULES_PACKAGE"]

DEFAULT_RULES_PACKAGE = "app.rules"


def discover_rules(package: ModuleType | str | None = None) -> dict[str, type[FraudRule]]:
    """Import every module in `package`, return {rule.name: RuleClass}.

    * modules whose name starts with "_" are skipped;
    * a module that fails to import is logged and skipped (the app still starts);
    * only concrete FraudRule subclasses *defined in* that module are collected;
    * two rules with the same ``name`` raise ValueError.
    """
    if package is None:
        package = DEFAULT_RULES_PACKAGE
    if isinstance(package, str):
        package = importlib.import_module(package)

    found: dict[str, type[FraudRule]] = {}
    paths = getattr(package, "__path__", None)
    if paths is None:
        raise ValueError(f"{package.__name__} is not a package")

    for module_info in sorted(pkgutil.iter_modules(paths), key=lambda m: m.name):
        mod_name = module_info.name
        if mod_name.startswith("_"):
            continue
        full_name = f"{package.__name__}.{mod_name}"
        try:
            module = importlib.import_module(full_name)
        except Exception:  # noqa: BLE001 - one broken rule file must not stop the app
            logger.exception("Could not import rule module %s; skipping it", full_name)
            continue

        for _, cls in inspect.getmembers(module, inspect.isclass):
            if (
                not issubclass(cls, FraudRule)
                or cls is FraudRule
                or inspect.isabstract(cls)
                or cls.__module__ != module.__name__
            ):
                continue
            rule_name = getattr(cls, "name", None)
            if not isinstance(rule_name, str) or not rule_name:
                logger.error("Rule class %s.%s has no 'name'; skipping", full_name, cls.__name__)
                continue
            if rule_name in found:
                other = found[rule_name]
                raise ValueError(
                    f"Duplicate rule name {rule_name!r}: {other.__module__}.{other.__name__} "
                    f"and {cls.__module__}.{cls.__name__}"
                )
            found[rule_name] = cls

    logger.info("Discovered %d rules: %s", len(found), ", ".join(sorted(found)))
    return found
