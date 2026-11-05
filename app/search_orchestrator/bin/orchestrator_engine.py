#!/usr/bin/env python3
"""Placeholder modular input. Replaced by the engine in a later task."""
import sys

SCHEME = """<scheme>
  <title>Search Orchestrator engine</title>
  <description>Advances Search Orchestrator runs.</description>
  <use_external_validation>false</use_external_validation>
  <use_single_instance>true</use_single_instance>
  <streaming_mode>simple</streaming_mode>
</scheme>
"""


def main(argv):
    if "--scheme" in argv:
        sys.stdout.write(SCHEME)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
