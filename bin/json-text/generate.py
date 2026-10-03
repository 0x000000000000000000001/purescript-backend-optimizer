#!/usr/bin/env python3
"""Specialize the native module decoder's input access; preserve its control flow.

Run after changing CoreFn/Json.go or these input templates. --check verifies that
the checked-in Text.go matches its inputs. No code generation runs at decoding
time, and the generated module has no build-time dependency on the benchmark.
"""
import argparse, re, subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
JSON = ROOT / 'src/PureScript/Backend/Optimizer/CoreFn/Json.go'
TARGET = JSON.with_suffix('') / 'Text.go'

def function(text, name, replacement):
    pattern = rf'^func {name}\([^\n]*\{{[^\n]*\}}\n|^func {name}\([^\n]*\{{\n.*?^\}}\n'
    result, count = re.subn(pattern, lambda match: (replacement(match[0]) if callable(replacement) else replacement)+'\n', text, flags=re.M|re.S)
    if count != 1:
        raise ValueError((name, count))
    return result

def specialize(text):
    for name in ['DecodeTypeTableImpl','IsNonNegativeInteger','DecodeArrayImpl','DecodeAnnWithUsageImpl']:
        text = function(text, name, '')
    # Surrogate lookahead indexes this array repeatedly. Materialize its cursors
    # once, as in the existing text decoder: tcArray.at walks from the beginning.
    def indexed_literals(body):
        body = re.sub(r'\belements\b', 'indexedElements', body)
        before = 'indexedElements := cndElements(raw)'
        assert body.count(before) == 1
        return body.replace(before, 'var indexedElements []any\n'
            '\t\tfor _, element := range cndElements(raw) {\n'
            '\t\t\tindexedElements = append(indexedElements, element)\n\t\t}')
    text = function(text, 'cndStringLiteralValue', indexed_literals)
    # Keep the text decoder's existing native Int-literal policy: the frontend
    # emits Int32-min as negate 2147483648. Type-table indices still use ntInt's
    # Int32 check; only ndInt/cndInt accept the operand before negation.
    literal_bound = 'float64(value) != number || value < -2147483648 || value > 2147483647'
    assert text.count(literal_bound) == 2
    text = text.replace(literal_bound, 'float64(value) != number')
    text = text.replace('// ndInt mirrors decodeInt: decodeNumber followed by Int.fromNumber.',
        '// ndInt decodes an Int literal. The native runtime represents Int as\n'
        '// int64, and the compiler encodes Int32-min as `negate 2147483648`: the\n'
        '// literal must keep its value so constant folding yields the right constant.')
    bodies = {
        'ntNative':'func ntNative(input any) any { return input }',
        'ntIsNull':"func ntIsNull(input any) (bool,bool) { return input.kind() == 'n', true }",
        'ntObjectOf':"func ntObjectOf(raw any) (ntObject,bool) { return raw, raw.kind() == '{' }",
        'ndNullable':"func ndNullable(raw any) bool { return raw.kind() == 'n' }",
        'ndNumber':'func ndNumber(raw any) (float64,*ndFailure) { if n,ok:=raw.number();ok{return n,nil};return 0,ndPublic("Number") }',
        'ndArray':'func ndArray(raw any) (tcArray,*ndFailure) { if a,ok:=raw.array();ok{return a,nil};return tcArray{},ndPublic("Array") }',
        'cndNumber':'func cndNumber(raw any) float64 { if n,ok:=raw.number();ok{return n};cndFail("Number");return 0 }',
        'cndElements':'func cndElements(raw any) tcArray { if a,ok:=raw.array();ok{return a};cndFail("Array");return tcArray{} }',
        'cndIsNull':"func cndIsNull(raw any) bool { return raw.kind() == 'n' }",
    }
    for name, body in bodies.items():
        text = function(text, name, body)
    text = text.replace('type ntObject = gopurs_runtime.JSONObjectView', 'type ntObject = tcCursor')
    text = re.sub(r'ntNative\(([\w.\[\]]+)\)', r'\1', text)
    for typ, method in [('string','text'),('float64','number'),('bool','boolean'),('[]any','array')]:
        text = re.sub(r'(\w+)\.\('+re.escape(typ)+r'\)', rf'\1.{method}()', text)
    text = text.replace('for i := range entries {\n\t\ttable.refs[i] = table.decodeRef(entries[i])', 'for i, entry := range entries.each {\n\t\ttable.refs[i] = table.decodeRef(entry)')
    text = re.sub(r'len\((arr|entries|elements)\)', r'\1.count', text)
    text = re.sub(r'range (arr|elements)\b', r'range \1.each', text)
    text = text.replace('range cndElements(raw) {', 'range cndElements(raw).each {')
    text = re.sub(r'for (\w+), (\w+) := range ([^\n]+)\.each \{', r'for cursorLoop := \3.iter(); cursorLoop.more(); {\n\1, \2 := cursorLoop.next()', text)
    text = re.sub(r'elements\[(\d+)\]', r'elements.at(\1)', text)
    text = re.sub(r'cndString\((cndFieldOf\([^\n]+?\))\)', r'\1.StrVal()', text)
    text = text.replace('jsonValue := gopurs_runtime.Box(raw)', 'jsonValue := gopurs_runtime.Box(directMaterialize(directCursor(raw)))')
    text = text.replace('json gopurs_runtime.Value) (result gopurs_runtime.Value)', 'json tcCursor) (result gopurs_runtime.Value)')
    text = re.sub(r'\bany\b', 'tcCursor', text)
    text = re.sub(r'\b((?:nt|nd|cnd)[A-Z]\w*|decodeTypeTableNative|appendWTF8Json)\b', lambda m:'tc_'+m[0], text)
    text = text.replace('func DecodeModuleImpl(', 'func tcDecodeModule(')
    for before, after in {
        'if s, ok := raw.text(); ok {':'if s, ok := raw.borrowedText(); ok {',
        'typ, typOK := typRaw.text()':'typ, typOK := typRaw.borrowedText()',
    }.items():
        assert text.count(before) == 1, before
        text = text.replace(before, after)
    for label in ['type','binderType','literalType','bindType']:
        before = f'kind := tc_cndFieldOf(obj, "{label}", tc_cndStringValue).StrVal()'
        assert text.count(before) == 1, before
        text = text.replace(before, before.replace('tc_cndStringValue', 'tcBorrowedTag'))
    return text

def generate():
    parts = [specialize(JSON.read_text()), (HERE/'index.go').read_text(), (HERE/'cursor.go').read_text()]
    imports = set()
    bodies = []
    for text in parts:
        block = re.search(r'^import \(\n(.*?)^\)\n', text, flags=re.M|re.S)
        if not block:
            raise ValueError('Missing import block')
        imports.update(line.strip() for line in block[1].splitlines() if line.strip())
        text = text[:block.start()]+text[block.end():]
        bodies.append(re.sub(r'^package \w+\n', '', text))
    text = '// Code generated by bin/json-text/generate.py; DO NOT EDIT.\n'
    text += 'package PureScript_Backend_Optimizer_CoreFn_Json_Text\n\nimport (\n'+ '\n'.join(sorted(imports))+'\n)\n'
    text += '\n'.join(bodies)
    text += '''
// Preserve the public parsing/error boundary while constructing owned values
// directly on the successful path. Validation completes before schema decoding.
func ParseModuleTextImpl(fallback, validate, printError gopurs_runtime.Value, text string) gopurs_runtime.Value {
    cursor, ok := directIndex(text)
    if !ok { return gopurs_runtime.Apply(fallback, gopurs_runtime.Str(text)) }
    result := tcDecodeModule(gopurs_runtime.Value{}, validate, tcCursor(cursor))
    if tc_cndIsLeft(result) {
        return tc_cndLeft(gopurs_runtime.Apply(printError, tc_cndLeftPayload(result)))
    }
    return result
}
'''
    return subprocess.check_output(['gofmt'], input=text.encode())

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    generated = generate()
    if args.check:
        if TARGET.read_bytes() != generated:
            raise SystemExit('Text.go is stale: run python3 bin/json-text/generate.py')
        print('Text.go matches the canonical native decoder and input templates')
    else:
        TARGET.write_bytes(generated)
        print(TARGET)
