import json

from so import alert_forms as af


def form(action, body):
    return af.form_params(action, '<form class="form-horizontal">%s</form>' % body)


def by_name(fields):
    return {f["name"]: f for f in fields}


def test_label_input_and_help_in_the_same_group():
    f = form("a", '''<div class="control-group">
      <label class="control-label" for="x">Sender</label>
      <div class="controls"><input type="text" name="action.a.param.sender" id="x" />
      <span class="help-block">
         Overrides the <span class="mono-space">sender</span>
         <a href="/help">Learn More</a>
      </span></div></div>''')
    assert f == [{"name": "sender", "label": "Sender", "help": "Overrides the sender",
                  "type": "text", "default": "", "required": False, "options": []}]


def test_help_in_the_next_group_belongs_to_the_field_before_it():
    f = form("a", '''<div class="control-group"><label>Node <span class="required">*</span> </label>
      <div class="controls"><input name="action.a.param.node"/></div></div>
      <div class="control-group"><div class="controls">
      <span class="help-block">The device</span></div></div>''')
    assert (f[0]["label"], f[0]["help"], f[0]["required"]) == ("Node", "The device", True)


def test_textarea_and_required_attribute():
    f = form("a", '<label>Body</label><textarea name="action.a.param.body" required>x</textarea>')
    assert (f[0]["type"], f[0]["required"]) == ("textarea", True)


def test_select_takes_static_options_and_the_selected_default():
    f = form("a", '''<label>Mode</label><select name="action.a.param.mode">
      <option value="">Choose</option><option value="1">One &amp; only</option>
      <option value="2" selected>Two</option></select>''')
    assert f[0]["type"] == "select" and f[0]["default"] == "2"
    assert f[0]["options"] == [{"value": "1", "label": "One & only"},
                               {"value": "2", "label": "Two"}]


def test_radio_inputs_merge_into_one_select_named_by_the_group_label():
    f = form("a", '''<label class="control-label">Category</label><div class="controls">
      <label class="radio"><input name="action.a.param.cat" type="radio" value="auto"/> Automatic</label>
      <label class="radio"><input name="action.a.param.cat" type="radio" value="ip" checked/> IP</label>
      </div>''')
    assert len(f) == 1 and f[0]["label"] == "Category" and f[0]["default"] == "ip"
    assert f[0]["options"] == [{"value": "auto", "label": "Automatic"},
                               {"value": "ip", "label": "IP"}]


def test_checkbox_is_named_by_its_wrapping_label():
    f = form("a", '''<label class="checkbox">
      <input type="checkbox" name="action.a.param.csv" value="1" CHECKED/> Attach a CSV</label>''')
    assert f[0]["label"] == "Attach a CSV" and f[0]["type"] == "select" and f[0]["default"] == "1"
    assert f[0]["options"] == [{"value": "1", "label": "On"}, {"value": "0", "label": "Off"}]


def test_splunk_control_group_elements():
    f = by_name(form("a", '''
      <splunk-control-group label="Names" help="One per line">
        <splunk-text-area name="action.a.param.names" required></splunk-text-area>
      </splunk-control-group>
      <splunk-control-group label="Sep" help="">
        <splunk-radio-input name="action.a.param.sep">
          <option value="comma">Comma</option><option value="nl" selected>Newline</option>
        </splunk-radio-input>
      </splunk-control-group>'''))
    assert (f["names"]["label"], f["names"]["help"], f["names"]["type"]) == \
        ("Names", "One per line", "textarea")
    assert f["names"]["required"] is True
    assert (f["sep"]["label"], f["sep"]["type"], f["sep"]["default"]) == ("Sep", "select", "nl")


def test_search_driven_dropdown_is_a_text_field():
    f = form("a", '''<label>Account</label><splunk-search-dropdown
      name="action.a.param.account" search="| rest /x" value-field="title"/>
      <label>URL</label><input type="text" name="action.a.param.url"/>''')
    assert [(x["name"], x["label"], x["type"]) for x in f] == \
        [("account", "Account", "text"), ("url", "URL", "text")]


def test_only_this_actions_valid_params_are_fields():
    f = form("a", '''<input name="action.a.param.purge "/><input name="action.b.param.other"/>
      <input name="action.a.include.link"/><input name="action.a.param.bad-name"/>
      <input type="hidden" name="action.a.param.secret"/>''')
    assert [x["name"] for x in f] == ["purge"]


def test_markup_is_reduced_to_plain_text():
    f = form("a", '''<label>Evil <script>alert(1)</script><b>bold</b></label>
      <input name="action.a.param.x"/>''')
    assert "<" not in f[0]["label"] and "bold" in f[0]["label"]


def test_long_text_is_capped():
    f = form("a", '<label>%s</label><input name="action.a.param.x"/><span class="help-block">%s</span>'
             % ("l" * 500, "h" * 2000))
    assert len(f[0]["label"]) <= af.MAX_LABEL and len(f[0]["help"]) <= af.MAX_HELP


def test_configured_defaults_win_over_the_form():
    content = {"param.index": "main", "param.source": ""}
    html = '''<label>Index</label><input name="action.a.param.index" value="other"/>
      <label>Source</label><input name="action.a.param.source" value="s"/>'''
    f = by_name(af.action_params("a", content, html))
    assert f["index"]["default"] == "main" and f["source"]["default"] == "s"


def test_settings_are_the_fields_only_without_a_form():
    content = {"param._cam": "{}", "param.verbose": "false", "param.bad-name": "1", "disabled": "0"}
    assert [(p["name"], p["label"], p["default"]) for p in af.action_params("a", content, None)] \
        == [("verbose", "verbose", "false")]
    html = '<label>Url</label><input name="action.a.param.url"/>'
    assert [p["name"] for p in af.action_params("a", content, html)] == ["url"]


def test_required_params_come_from_cam_metadata():
    content = {"param._cam": json.dumps({"required_params": ["param.field"]}), "param.field": ""}
    assert af.action_params("a", content, None) == [
        {"name": "field", "label": "field", "help": "", "type": "text", "default": "",
         "required": True, "options": []}]
    assert af.action_params("a", {"param._cam": "not json", "param.x": ""}, None)[0]["required"] is False
