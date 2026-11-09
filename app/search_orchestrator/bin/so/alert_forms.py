"""The parameters of an alert action, for the job builder.

Splunk has no parameter schema for alert actions. It has two partial sources:
the ``param.*`` settings from alert_actions.conf (names and defaults, often
incomplete) and the HTML form each action ships for the alert editor (names,
labels, help and input types). The form decides which fields exist; the
settings add defaults, and are the fields only when there is no form.

Forms are written by add-ons, so they are reduced here to plain data and never
reach the browser as markup.

A parameter is ``{"name", "label", "help", "type", "default", "required",
"options"}``: ``type`` is ``text``, ``textarea`` or ``select`` and ``options`` is
``[{"value", "label"}]``. A dropdown filled by a search is a ``text`` field: its
search is the add-on's SPL, which the builder does not run.
"""
import json
from html.parser import HTMLParser

from .hidden import PARAM_NAME_RE

MAX_LABEL = 120
MAX_HELP = 500
_SELECTS = ("select", "splunk-select", "splunk-radio-input")
_TEXTAREAS = ("textarea", "splunk-text-area")
_FIELDS = ("input", "splunk-text-input", "splunk-search-dropdown") + _SELECTS + _TEXTAREAS


def _clean(parts):
    return " ".join("".join(parts).split())


class _Form(HTMLParser):
    """Collects the action's fields. Labels and help are matched by position: a field
    takes the label closed just before it, or its wrapping label, and the first help
    block after it."""

    def __init__(self, action):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.prefix = "action.%s.param." % action
        self.fields = []
        self.by_name = {}
        self.label = None  # the open <label>
        self.prior = ""  # text of the last closed label that wrapped no field
        self.group = None  # (label, help) of the open splunk-control-group
        self.help = None  # text of the open help block
        self.help_tag = None
        self.help_depth = 0
        self.links = 0
        self.select = None  # the field whose <option>s are being read
        self.option = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a":
            self.links += 1
        elif tag == "label":
            self.label = {"text": [], "targets": []}
        elif tag == "splunk-control-group":
            self.group = (a.get("label") or "", a.get("help") or "")
        elif tag == "option":
            if self.select is not None:
                self._end_option()
                self.option = {"value": a.get("value"), "selected": "selected" in a, "text": []}
        elif tag in _FIELDS:
            self._field(tag, a)
        elif self.help is not None:
            if tag == self.help_tag:
                self.help_depth += 1
        elif "help-block" in (a.get("class") or "").split():
            self.help, self.help_tag, self.help_depth = [], tag, 1

    def handle_endtag(self, tag):
        if tag == "a":
            self.links = max(0, self.links - 1)
        elif tag == "label" and self.label is not None:
            self._end_label()
        elif tag == "splunk-control-group":
            self.group = None
        elif tag == "option":
            self._end_option()
        elif tag in _SELECTS:
            self._end_option()
            self.select = None
        elif self.help is not None and tag == self.help_tag:
            self.help_depth -= 1
            if self.help_depth == 0:
                if self.fields and not self.fields[-1]["help"]:
                    self.fields[-1]["help"] = _clean(self.help)
                self.help = None

    def handle_data(self, data):
        if self.links:
            return
        if self.option is not None:
            self.option["text"].append(data)
        elif self.help is not None:
            self.help.append(data)
        elif self.label is not None:
            self.label["text"].append(data)

    def _end_label(self):
        text = _clean(self.label["text"])
        for target in self.label["targets"]:
            if text:
                if "value" in target:  # a radio option
                    target["label"] = text
                else:
                    self._set_label(target, text)
        if not self.label["targets"]:
            self.prior = text
        self.label = None

    def _end_option(self):
        if self.option is None:
            return
        option, self.option = self.option, None
        text = _clean(option["text"])
        value = text if option["value"] is None else option["value"]
        if value:  # an empty value is a "Choose..." placeholder
            self.select["options"].append({"value": value, "label": text or value})
            if option["selected"]:
                self.select["default"] = value

    @staticmethod
    def _set_label(field, text):
        if text.endswith("*"):
            field["required"] = True
            text = text.rstrip(" *")
        field["label"] = text or field["name"]

    def _field(self, tag, a):
        full = (a.get("name") or "").strip()
        if not full.startswith(self.prefix):
            return
        name = full[len(self.prefix):]
        kind = (a.get("type") or "text").lower() if tag == "input" else ""
        if kind == "hidden" or not PARAM_NAME_RE.fullmatch(name):
            return
        field = self.by_name.get(name)
        if field is None:
            field = {"name": name, "label": name, "help": "", "type": "text", "default": "",
                     "required": False, "options": []}
            self.fields.append(field)
            self.by_name[name] = field
            if self.group:
                self._set_label(field, self.group[0])
                field["help"] = self.group[1].strip()
            elif self.prior:
                self._set_label(field, self.prior)
            self.prior = ""
        elif kind != "radio":
            return
        if "required" in a:
            field["required"] = True
        wrapped = self.label["targets"] if self.label is not None else []
        if kind == "radio":
            option = {"value": a.get("value") or "on", "label": a.get("value") or "on"}
            field["options"].append(option)
            if "checked" in a:
                field["default"] = option["value"]
            wrapped.append(option)
            return
        wrapped.append(field)
        if kind == "checkbox":
            value = a.get("value") or "1"
            field["options"] = [{"value": value, "label": "On"}, {"value": "0", "label": "Off"}]
            if "checked" in a:
                field["default"] = value
        elif tag in _SELECTS:
            self.select = field
        elif tag in _TEXTAREAS:
            field["type"] = "textarea"
        else:
            field["default"] = a.get("value") or ""

    def result(self):
        self._end_option()
        for field in self.fields:
            if field["options"]:
                field["type"] = "select"
            field["label"] = field["label"][:MAX_LABEL]
            field["help"] = field["help"][:MAX_HELP]
        return self.fields


def form_params(action, html):
    """The parameters on an alert action's HTML form, in form order."""
    parser = _Form(action)
    parser.feed(html or "")
    parser.close()
    return parser.result()


def _required(cam):
    """Parameter names from the ``required_params`` of a ``param._cam`` JSON setting."""
    try:
        listed = json.loads(cam).get("required_params") or []
    except (TypeError, ValueError, AttributeError):
        return set()
    return {str(p)[len("param."):] for p in listed if str(p).startswith("param.")}


def action_params(action, content, html):
    """An action's parameters from its alert_actions ``content`` and its form, if any."""
    conf = {k[len("param."):]: v for k, v in content.items() if k.startswith("param.")}
    fields = form_params(action, html)
    if not fields:
        fields = [{"name": k, "label": k, "help": "", "type": "text", "default": "",
                   "required": False, "options": []}
                  for k in sorted(conf)
                  if not k.startswith("_") and PARAM_NAME_RE.fullmatch(k)]
    required = _required(conf.get("_cam"))
    for field in fields:
        if conf.get(field["name"]) not in (None, ""):
            field["default"] = str(conf[field["name"]])
        if field["name"] in required:
            field["required"] = True
    return fields
