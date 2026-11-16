(function () {
    var NBSP = ' ';
    var math = CalqueMath.setup(window.math);

    // ---------- Дерево групп ----------

    function TreeNode(name, key) {
        this.name = name;
        this.key = key;
        this.children = new Map();
        this.line = null;
    }

    TreeNode.prototype.child = function (name, exact) {
        if (exact) {
            var n = this.children.get(name.toLowerCase());
            return n && n.name === name ? n : null;
        }
        return this.children.get(name.toLowerCase()) || null;
    };

    function Tree() { this.root = new TreeNode('', ''); }

    Tree.prototype.add = function (path, line) {
        var node = this.root;
        for (var i = 0; i < path.length; i++) {
            var lower = path[i].toLowerCase();
            var next = node.children.get(lower);
            if (!next) {
                next = new TreeNode(path[i], path.slice(0, i + 1).join('.'));
                node.children.set(lower, next);
            }
            node = next;
        }
        node.line = line;
        return node;
    };

    // Ищем путь сначала с точным регистром, потом без учёта регистра
    Tree.prototype.resolve = function (path) {
        var node = this.root;
        for (var i = 0; i < path.length && node; i++) node = node.child(path[i], false);
        return node && node !== this.root ? node : null;
    };

    // ---------- Форматирование ----------

    function groupDigits(str) {
        return str.replace(/(^|[^\d.eE])(\d{5,})/g, function (m, p, d) {
            return p + d.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
        });
    }

    function formatValue(v) {
        if (v === undefined || v === null) return '';
        if (typeof v === 'function') return '';
        if (typeof v === 'boolean') return v ? 'да' : 'нет';
        if (typeof v === 'string') return v;
        return groupDigits(math.format(v, { precision: 12 }));
    }

    function formatPercent(p) {
        var a = Math.abs(p);
        var s = a >= 10 || a === 0 ? Math.round(p).toString() : p.toFixed(1).replace(/\.0$/, '');
        return s.replace('.', ',') + '%';
    }

    function isNumeric(v) {
        return typeof v === 'number' && isFinite(v);
    }

    // ---------- Числа под курсором ----------

    var NUMBER_RE = /\d+(?:\.\d+)?/g;

    function numberAt(text, lineStart, caret) {
        var lineEnd = text.indexOf('\n', lineStart);
        if (lineEnd < 0) lineEnd = text.length;
        var line = text.substring(lineStart, lineEnd);
        var pos = caret - lineStart;
        NUMBER_RE.lastIndex = 0;
        var m;
        while ((m = NUMBER_RE.exec(line))) {
            var start = m.index, end = start + m[0].length;
            var before = line.charAt(start - 1);
            if (/[\p{L}_\d.]/u.test(before)) continue; // часть имени вроде x2
            if (pos < start || pos > end) continue;
            // Минус считаем частью числа, если перед ним знак операции или начало
            var prefix = line.substring(0, start);
            if (/(^|[=(,:+\-*\/^]\s*)-$/.test(prefix)) start--;
            return { start: lineStart + start, end: lineStart + end, text: line.substring(start, end) };
        }
        return null;
    }

    function stepNumber(str, direction, big) {
        var decimals = (str.split('.')[1] || '').length;
        var step = Math.pow(10, -decimals) * (big ? 10 : 1);
        var value = parseFloat(str) + direction * step;
        return value.toFixed(decimals);
    }

    // ---------- Ссылка ----------

    function toBase64Url(bytes) {
        var bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function fromBase64Url(str) {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) str += '=';
        var bin = atob(str), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    function pipe(bytes, stream) {
        return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()
            .then(function (b) { return new Uint8Array(b); });
    }

    function encodeText(text) {
        var bytes = new TextEncoder().encode(text);
        if (typeof CompressionStream === 'undefined') return Promise.resolve('t=' + toBase64Url(bytes));
        return pipe(bytes, new CompressionStream('deflate-raw')).then(function (z) { return 'z=' + toBase64Url(z); });
    }

    function decodeText(hash) {
        hash = hash.replace(/^#/, '');
        var kind = hash.substring(0, 2), data = hash.substring(2);
        try {
            if (kind === 't=') return Promise.resolve(new TextDecoder().decode(fromBase64Url(data)));
            if (kind === 'z=') return pipe(fromBase64Url(data), new DecompressionStream('deflate-raw'))
                .then(function (b) { return new TextDecoder().decode(b); });
        } catch (e) { /* битая ссылка */ }
        return Promise.resolve(null);
    }

    // ---------- Буфер обмена ----------

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
        }
        return Promise.resolve(legacyCopy(text));
    }

    function legacyCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* ничего */ }
        document.body.removeChild(ta);
    }

    // =====================================================

    // =====================================================
    // Редактор на CodeMirror 6

    var CM = window.CM;

    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function isHeaderCode(code) {
        var t = splitComment(code).code.trim();
        return t.length > 1 && t.slice(-1) === ':';
    }

    function indentOf(code) {
        return Math.floor(code.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length / 2);
    }

    // Результат справа от строки или под ней
    class HintWidget extends CM.WidgetType {
        constructor(d, block, indent) {
            super();
            this.d = d;
            this.block = block;
            this.indent = indent;
        }

        eq(o) {
            return o.block === this.block && o.indent === this.indent && o.d.type === this.d.type && o.d.data === this.d.data && o.d.prefix === this.d.prefix;
        }

        toDOM() {
            var el = document.createElement(this.block ? 'div' : 'span');
            el.className = 'cm-hint cm-hint-' + this.d.type + (this.block ? ' cm-hint-block' : '');
            if (this.block) el.style.paddingLeft = 'calc(' + (this.indent * 2) + 'ch + 2px)';
            var prefix = this.block ? this.d.prefix.replace(/^ /, '') : this.d.prefix;
            el.innerHTML = '<span class="cm-hint-prefix">' + escapeHtml(prefix) + '</span>' + escapeHtml(this.d.data);
            return el;
        }

        ignoreEvent() { return false; }
    }

    // Подсветка: группы, формулы, :=, числа, комментарии
    var language = CM.StreamLanguage.define({
        name: 'calque',
        startState: function () { return { start: true }; },
        token: function (stream, state) {
            if (stream.sol()) state.start = true;
            if (stream.eatSpace()) return null;
            if (stream.peek() === '#') { stream.skipToEnd(); return 'comment'; }
            if (state.start) {
                state.start = false;
                if (stream.match(/^[^:#=]+:(?=\s*(#.*)?$)/)) return 'heading';
                if (stream.match(/^_[\p{L}][\p{L}\p{N}_]*/u)) return 'keyword';
                if (stream.match(/^[\p{L}_][\p{L}\p{N}_]*(?=\s*:=)/u)) return 'atom';
            }
            if (stream.match(':=')) return 'operator';
            if (stream.match(/^\d+(\.\d+)?(e[+-]?\d+)?/i)) return 'number';
            if (stream.match(/^[\p{L}_][\p{L}\p{N}_]*/u)) return 'variableName';
            stream.next();
            return null;
        }
    });

    var highlight = CM.HighlightStyle.define([
        { tag: CM.tags.comment, class: 'tok-comment' },
        { tag: CM.tags.heading, class: 'tok-heading' },
        { tag: CM.tags.keyword, class: 'tok-formula' },
        { tag: CM.tags.atom, class: 'tok-nosum' },
        { tag: CM.tags.operator, class: 'tok-operator' },
        { tag: CM.tags.number, class: 'tok-number' }
    ]);

    // Группа сворачивается до первой строки с тем же или меньшим отступом
    var folding = CM.foldService.of(function (state, from) {
        var line = state.doc.lineAt(from);
        if (!isHeaderCode(line.text)) return null;
        var indent = indentOf(line.text);
        var end = line;
        for (var n = line.number + 1; n <= state.doc.lines; n++) {
            var next = state.doc.line(n);
            if (!next.text.trim() || indentOf(next.text) <= indent) break;
            end = next;
        }
        return end.number > line.number ? { from: line.to, to: end.to } : null;
    });

    function Calque(container, options) {
        var calque = this;
        options = options || {};

        calque.container = container;
        calque.storageKey = options.storageKey === undefined ? 'input' : options.storageKey;
        calque.onChange = options.onChange || null;

        calque.raw = null;
        calque.lines = [];
        calque.cache = {};
        calque.tree = new Tree();
        calque.scope = new Map();
        calque.suffix = {};

        var initial = options.text || '';
        if (calque.storageKey) {
            try {
                var stored = localStorage.getItem(calque.storageKey);
                if (stored !== null) initial = stored;
            } catch (e) { /* приватный режим */ }
        }

        calque.resultsField = CM.StateField.define({
            create: function (state) { return calque.decorate(state); },
            update: function (deco, tr) {
                var folds = tr.effects.some(function (e) { return e.is(CM.foldEffect) || e.is(CM.unfoldEffect); });
                return tr.docChanged || tr.selection || folds ? calque.decorate(tr.state) : deco;
            },
            provide: function (f) { return CM.EditorView.decorations.from(f); }
        });

        calque.gutterSlot = new CM.Compartment();
        calque.settings = { lineNumbers: !!options.lineNumbers, autoFormat: !!options.autoFormat };

        calque.extensions = [
            calque.gutterSlot.of(calque.settings.lineNumbers ? CM.lineNumbers() : []),
            calque.resultsField,
            CM.history(),
            CM.drawSelection(),
            CM.highlightActiveLine(),
            CM.EditorView.lineWrapping,
            CM.indentUnit.of('  '),
            language,
            CM.syntaxHighlighting(highlight),
            folding,
            CM.codeFolding({ placeholderText: '…' }),
            CM.foldGutter({
                markerDOM: function (open) {
                    var el = document.createElement('span');
                    el.className = 'cm-fold-marker';
                    el.textContent = open ? '▾' : '▸';
                    return el;
                }
            }),
            CM.EditorState.allowMultipleSelections.of(true),
            CM.rectangularSelection(),
            CM.crosshairCursor(),
            CM.bracketMatching(),
            CM.closeBrackets(),
            CM.highlightSelectionMatches({ highlightWordAroundCursor: true, minSelectionLength: 2 }),
            CM.search({ top: true }),
            CM.EditorState.phrases.of(PHRASES),
            CM.linter(function (view) { return calque.diagnostics(view.state); }, { delay: 400 }),
            calque.infoField(),
            CM.hoverTooltip(function (view, pos) {
                // Если значение уже показано по нажатию, второе не нужно
                if (view.state.field(calque.info, false)) return null;
                return calque.infoAt(view.state, pos);
            }, { hoverTime: 350 }),
            CM.autocompletion({
                override: [function (ctx) { return calque.complete(ctx); }],
                icons: false
            }),
            CM.keymap.of(calque.keys().concat(CM.closeBracketsKeymap, CM.searchKeymap, CM.foldKeymap, CM.historyKeymap, CM.defaultKeymap)),
            CM.EditorView.updateListener.of(function (u) { calque.autoFormatOnLeave(u); calque.updateHistoryButtons(); }),
            CM.EditorView.updateListener.of(function (u) {
                if (!u.docChanged) return;
                var text = u.state.doc.toString();
                if (calque.onChange) calque.onChange(text);
                if (calque.storageKey) {
                    try { localStorage.setItem(calque.storageKey, text); } catch (e) { /* приватный режим */ }
                }
            }),
            CM.EditorView.contentAttributes.of({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' })
        ];

        calque.view = new CM.EditorView({
            state: CM.EditorState.create({ doc: initial, extensions: calque.extensions }),
            parent: container
        });

        if (options.toolbar) calque.buildToolbar(options.toolbar);
    }

    // Новый текст с чистой историей отмены — для переключения вкладок
    Calque.prototype.setText = function (text) {
        this.view.setState(CM.EditorState.create({ doc: text, extensions: this.extensions }));
        this.updateHistoryButtons();
    };

    Calque.prototype.setLineNumbers = function (on) {
        this.settings.lineNumbers = !!on;
        this.view.dispatch({ effects: this.gutterSlot.reconfigure(on ? CM.lineNumbers() : []) });
    };

    Calque.prototype.setAutoFormat = function (on) {
        this.settings.autoFormat = !!on;
        this.lastLine = null;
    };

    Calque.prototype.formatAll = function () {
        var state = this.view.state;
        var text = state.doc.toString();
        var formatted = formatText(text);
        if (formatted === text) { this.toast('Уже отформатировано'); return; }
        var head = state.doc.lineAt(state.selection.main.head).number;
        var doc = CM.EditorState.create({ doc: formatted }).doc;
        var pos = doc.line(Math.min(head, doc.lines)).to;
        this.view.dispatch({ changes: { from: 0, to: text.length, insert: formatted }, selection: { anchor: pos }, userEvent: 'format' });
        this.toast('Отформатировано');
    };

    // Строку форматируем, когда с неё ушли: пока её набирают, не трогаем
    Calque.prototype.autoFormatOnLeave = function (u) {
        var calque = this;
        var state = u.state;
        var current = state.doc.lineAt(state.selection.main.head);
        if (!calque.settings.autoFormat || u.transactions.some(function (tr) { return tr.isUserEvent('format'); })) {
            calque.lastLine = current.from;
            return;
        }
        if (calque.lastLine !== null && calque.lastLine !== undefined && (u.docChanged || u.selectionSet)) {
            var from = u.changes.mapPos(calque.lastLine, -1);
            if (from <= state.doc.length) {
                var left = state.doc.lineAt(from);
                if (left.number !== current.number) {
                    var formatted = formatLine(left.text);
                    if (formatted !== left.text) {
                        Promise.resolve().then(function () {
                            var now = calque.view.state.doc;
                            if (left.to > now.length || now.sliceString(left.from, left.to) !== left.text) return;
                            calque.view.dispatch({ changes: { from: left.from, to: left.to, insert: formatted }, userEvent: 'format' });
                        });
                    }
                }
            }
        }
        calque.lastLine = current.from;
    };

    Calque.prototype.getText = function () {
        return this.view.state.doc.toString();
    };

    Calque.prototype.focus = function () {
        this.view.focus();
    };

    // Пересчёт и разметка результатов
    Calque.prototype.decorate = function (state) {
        var calque = this;
        var text = state.doc.toString();
        if (text !== calque.raw) {
            calque.raw = text;
            calque.recalc();
        }

        var sel = state.selection.main;
        calque.lines.forEach(function (line) {
            line.selected = line.positionEnd >= sel.from && line.positionStart <= sel.to;
        });

        // Результаты внутри свёрнутых групп не показываем
        var hidden = [];
        CM.foldedRanges(state).between(0, state.doc.length, function (from, to) { hidden.push([from, to]); });
        function isHidden(pos) {
            return hidden.some(function (r) { return pos > r[0] && pos <= r[1]; });
        }

        var b = new CM.RangeSetBuilder();
        calque.lines.forEach(function (line) {
            if (isHidden(line.positionEnd)) return;

            // Перенесённые строки начинаются под текстом, а не с края
            if (line.indent > 0) {
                var w = line.indent * 2;
                b.add(line.positionStart, line.positionStart, CM.Decoration.line({
                    class: 'cm-indented',
                    attributes: { style: 'padding-left: calc(' + w + 'ch + 2px); text-indent: -' + w + 'ch; background-size: ' + w + 'ch 100%;' }
                }));
            }
            var d = calque.describeLine(line);
            if (!d.data || (d.type !== 'result' && d.type !== 'percent' && d.type !== 'error')) return;

            var below = !!splitComment(line.code).comment;
            b.add(line.positionEnd, line.positionEnd, CM.Decoration.widget({
                widget: new HintWidget(d, below, line.indent),
                side: 1,
                block: below
            }));
        });
        return b.finish();
    };

    // ---------- Автоформат ----------

    var BINARY = { '+': 1, '-': 1, '*': 1, '/': 1, '=': 1, ':=': 1, '==': 1, '!=': 1, '<=': 1, '>=': 1, '<': 1, '>': 1 };
    var OPENERS = { '(': 1, '[': 1 };
    var CLOSERS = { ')': 1, ']': 1 };

    // Разбиваем выражение на части и запоминаем, был ли перед частью пробел
    function tokenize(src) {
        var tokens = [], i = 0, space = false, m;
        while (i < src.length) {
            var rest = src.slice(i);
            if ((m = rest.match(/^\s+/))) { space = true; i += m[0].length; continue; }
            if ((m = rest.match(/^("([^"\\]|\\.)*"?|'([^'\\]|\\.)*'?)/))) {}
            else if ((m = rest.match(/^\d+(\.\d+)?(e[+-]?\d+)?(?![\p{L}_])/iu))) {}
            else if ((m = rest.match(/^\d+(\.\d+)?/))) {}
            else if ((m = rest.match(/^[\p{L}_][\p{L}\p{N}_]*(\.[\p{L}_][\p{L}\p{N}_]*)*/u))) {}
            else if ((m = rest.match(/^(:=|==|!=|<=|>=)/))) {}
            else m = [rest[0]];
            tokens.push({ t: m[0], space: space });
            space = false;
            i += m[0].length;
        }
        return tokens;
    }

    function formatExpr(src) {
        var tokens = tokenize(src);
        var out = '';
        tokens.forEach(function (tok, k) {
            var prev = tokens[k - 1];
            var t = tok.t;
            if (!prev) { out += t; return; }
            var p = prev.t;
            var unary = (t === '-' || t === '+') && (k === 0 || BINARY[p] || OPENERS[p] || p === ',' || p === ';' || p === '^' || p === ':');
            var prevUnary = (p === '-' || p === '+') && prev.unary;
            tok.unary = unary;
            var sp;
            if (t === ',' || t === ';') sp = false;
            else if (p === ',' || p === ';') sp = true;
            else if (t === '^' || p === '^') sp = false;
            else if (CLOSERS[t] || OPENERS[p]) sp = false;
            else if (prevUnary) sp = false;
            else if (t === ':' && k === tokens.length - 1) sp = false;
            else if (BINARY[t] && !unary) sp = true;
            else if (BINARY[p] && !prevUnary) sp = true;
            else if (unary) sp = tok.space || !!BINARY[p] || p === ',';
            else sp = tok.space;
            out += (sp ? ' ' : '') + t;
        });
        return out;
    }

    function formatLine(code) {
        if (!code.trim()) return '';
        var lead = code.match(/^[ \t]*/)[0];
        var indent = new Array(Math.floor(lead.replace(/\t/g, '  ').length / 2) + 1).join('  ');
        var parts = splitComment(code.slice(lead.length));
        var body = formatExpr(parts.code.trim());
        var comment = parts.comment ? parts.comment.replace(/^#\s*/, '# ').replace(/\s+$/, '') : '';
        if (comment === '# ') comment = '#';
        return indent + body + (comment ? (body ? ' ' : '') + comment : '');
    }

    function formatText(text) {
        var lines = text.split('\n').map(formatLine);
        var out = [];
        lines.forEach(function (l) {
            if (l === '' && out.length && out[out.length - 1] === '') return;
            out.push(l);
        });
        return out.join('\n');
    }

    Calque.formatLine = formatLine;
    Calque.formatText = formatText;

    // ---------- Ошибки в тексте ----------

    var PHRASES = {
        'Find': 'Найти',
        'Replace': 'Заменить на',
        'next': 'дальше',
        'previous': 'назад',
        'all': 'все',
        'match case': 'с учётом регистра',
        'regexp': 'регулярное выражение',
        'by word': 'слово целиком',
        'replace': 'заменить',
        'replace all': 'заменить все',
        'close': 'закрыть',
        'current match': 'текущее совпадение',
        'on line': 'в строке',
        'Folded lines': 'Свёрнутые строки',
        'Unfolded lines': 'Развёрнутые строки',
        'unfold': 'развернуть',
        'Fold line': 'Свернуть',
        'Unfold line': 'Развернуть',
        'Diagnostics': 'Ошибки',
        'No diagnostics': 'Ошибок нет'
    };

    // Где в строке ошибка: позиция из сообщения math.js или неизвестное имя
    function errorRange(line, message, bare) {
        var start = line.positionStart, end = line.positionStart + bare.length;
        var m = /\(char (\d+)\)/.exec(message);
        if (m) {
            var at = Math.min(parseInt(m[1], 10) - 1, Math.max(0, bare.length - 1));
            return { from: start + at, to: Math.min(end, start + at + 1) };
        }
        m = /Undefined (?:symbol|function) ([\p{L}\p{N}_.]+)/u.exec(message);
        if (m) {
            var re = new RegExp('(^|[^\\p{L}\\p{N}_])(' + m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![\\p{L}\\p{N}_])', 'u');
            var found = re.exec(bare);
            if (found) {
                var from = start + found.index + found[1].length;
                return { from: from, to: from + found[2].length };
            }
        }
        var lead = bare.match(/^\s*/)[0].length;
        return { from: start + lead, to: Math.max(start + lead + 1, end) };
    }

    Calque.prototype.diagnostics = function (state) {
        var calque = this;
        if (state.doc.toString() !== calque.raw) {
            calque.raw = state.doc.toString();
            calque.recalc();
        }
        var head = state.selection.main.head;
        var out = [];
        calque.lines.forEach(function (line) {
            var message = line.error || line.rowError || (line.summing && !line.record ? line.groupError : null);
            if (!message) return;
            // Строку, которую сейчас набирают, не подчёркиваем
            if (head >= line.positionStart && head <= line.positionEnd) return;
            var bare = splitComment(line.code).code;
            if (!bare.trim()) return;
            var r = errorRange(line, message, bare);
            out.push({ from: r.from, to: Math.min(r.to, state.doc.length), severity: 'error', message: message });
        });
        return out;
    };

    // ---------- Значение имени по нажатию и наведению ----------

    Calque.prototype.infoAt = function (state, pos) {
        var calque = this;
        var line = state.doc.lineAt(pos);
        var text = line.text;
        var rel = pos - line.from;
        if (splitComment(text).code.length < rel) return null;

        var re = /[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)*/gu, m;
        while ((m = re.exec(text))) {
            if (rel < m.index || rel > m.index + m[0].length) continue;
            // Путь берём до той части, на которую нажали
            var upto = text.slice(m.index, Math.max(rel, m.index + 1));
            var tail = text.slice(m.index + upto.length).match(/^[\p{L}\p{N}_]*/u)[0];
            var name = (upto + tail).replace(/^_/, '');
            var info = calque.describeName(name);
            if (!info) return null;
            return {
                pos: line.from + m.index,
                end: line.from + m.index + m[0].length,
                above: true,
                create: function () {
                    var dom = document.createElement('div');
                    dom.className = 'cm-info';
                    dom.innerHTML = '<b>' + escapeHtml(info.name) + '</b> = ' + escapeHtml(info.value) +
                        (info.where ? '<div class="cm-info-where">' + escapeHtml(info.where) + '</div>' : '');
                    return { dom: dom };
                }
            };
        }
        return null;
    };

    Calque.prototype.describeName = function (name) {
        var calque = this;
        var node = name.indexOf('.') >= 0 ? calque.tree.resolve(name.split('.')) : null;
        var key = node ? node.key : name;
        var value = calque.scope.has(key) ? calque.scope.get(key) : undefined;
        if (value === undefined && !node) {
            var root = calque.tree.resolve([name]);
            if (root) { node = root; key = root.key; value = calque.scope.get(key); }
        }
        if (value === undefined || value === null) return null;

        var shown;
        if (typeof value === 'function') shown = 'функция';
        else if (value && typeof value === 'object' && !value.isUnit && !value.isMatrix && !value.isFraction && !value.isComplex && !Array.isArray(value)) {
            shown = Object.keys(value).map(function (k) { return k + ' ' + formatValue(value[k]); }).join(' · ');
        } else shown = formatValue(value);

        var line = node && node.line ? node.line : calque.defs[name];
        return { name: key, value: shown, where: line ? 'строка ' + (line.index + 1) : '' };
    };

    // По нажатию в имя показываем его значение, по следующему действию прячем
    Calque.prototype.infoField = function () {
        var calque = this;
        calque.info = CM.StateField.define({
            create: function () { return null; },
            update: function (tip, tr) {
                if (tr.docChanged) return null;
                if (!tr.selection) return tip;
                var r = tr.state.selection.main;
                if (!r.empty || !tr.isUserEvent('select.pointer')) return null;
                return calque.infoAt(tr.state, r.head);
            },
            provide: function (f) { return CM.showTooltip.from(f); }
        });
        return calque.info;
    };

    // ---------- Клавиши ----------

    function selectionNumber(state) {
        var r = state.selection.main;
        var sel = state.sliceDoc(r.from, r.to);
        if (/^-?\d+(\.\d+)?$/.test(sel)) return { start: r.from, end: r.to, text: sel };
        return null;
    }

    Calque.prototype.keys = function () {
        var calque = this;
        return [
            { key: 'Tab', run: function (v) { return CM.acceptCompletion(v) || CM.indentMore(v); } },
            { key: 'Shift-Tab', run: CM.indentLess },
            {
                key: 'Enter',
                run: function (v) {
                    var line = v.state.doc.lineAt(v.state.selection.main.head);
                    var indent = line.text.match(/^ */)[0];
                    if (isHeaderCode(line.text)) indent += '  ';
                    v.dispatch(v.state.replaceSelection('\n' + indent), { scrollIntoView: true, userEvent: 'input' });
                    return true;
                }
            },
            { key: 'Mod-d', run: function () { calque.duplicateSelection(); return true; } },
            { key: 'Shift-Alt-f', run: function () { calque.formatAll(); return true; } },
            { key: 'ArrowUp', run: function () { return calque.stepSelected(1, false); }, shift: function () { return calque.stepSelected(1, true); } },
            { key: 'ArrowDown', run: function () { return calque.stepSelected(-1, false); }, shift: function () { return calque.stepSelected(-1, true); } }
        ];
    };

    Calque.prototype.stepSelected = function (direction, big) {
        var t = selectionNumber(this.view.state);
        if (!t) return false;
        this.replaceRange(t.start, t.end, stepNumber(t.text, direction, big), true);
        return true;
    };

    Calque.prototype.replaceRange = function (start, end, text, select) {
        this.view.dispatch({
            changes: { from: start, to: end, insert: text },
            selection: select ? { anchor: start, head: start + text.length } : { anchor: start + text.length },
            userEvent: 'input'
        });
    };

    Calque.prototype.duplicateSelection = function () {
        var state = this.view.state, r = state.selection.main;
        if (r.empty) {
            var line = state.doc.lineAt(r.head);
            this.view.dispatch({ changes: { from: line.to, insert: '\n' + line.text }, selection: { anchor: r.head + line.length + 1 } });
        } else {
            var text = state.sliceDoc(r.from, r.to);
            this.view.dispatch({ changes: { from: r.to, insert: text }, selection: { anchor: r.to, head: r.to + text.length } });
        }
    };

    Calque.prototype.addIndent = function () { CM.indentMore(this.view); };
    Calque.prototype.removeIndent = function () { CM.indentLess(this.view); };

    // ---------- Автодополнение ----------

    Calque.prototype.complete = function (ctx) {
        var calque = this;
        var m = ctx.matchBefore(/[\p{L}\p{N}_.]+/u);
        if (!m || /^[\d.]/.test(m.text)) return null;
        var line = ctx.state.doc.lineAt(ctx.pos);
        if (line.text.slice(0, ctx.pos - line.from).indexOf('#') >= 0) return null;

        var segments = m.text.split('.');
        var partial = segments.pop();
        var options = [];

        function option(label, insert, value, group) {
            var detail = formatValue(value);
            options.push({
                label: label,
                detail: detail || undefined,
                type: group ? 'class' : 'variable',
                apply: function (view, completion, from, to) {
                    view.dispatch({
                        changes: { from: m.from, to: to, insert: insert + (group ? '.' : '') },
                        selection: { anchor: m.from + insert.length + (group ? 1 : 0) }
                    });
                    if (group) setTimeout(function () { CM.startCompletion(view); });
                }
            });
        }

        if (segments.length) {
            var node = calque.tree.resolve(segments);
            if (!node) return null;
            node.children.forEach(function (child) {
                option(child.name, node.key + '.' + child.name, calque.scope.get(child.key), child.children.size > 0);
            });
        } else {
            if (!partial.length && !ctx.explicit) return null;
            var seen = {};
            var add = function (name, insert, value, group) {
                if (seen[name]) return;
                seen[name] = true;
                option(name, insert, value, group);
            };
            calque.tree.root.children.forEach(function (child) {
                add(child.name, child.name, calque.scope.get(child.key), child.children.size > 0);
            });
            calque.scope.forEach(function (value, key) {
                if (key.indexOf('.') >= 0 || key === 'last') return;
                if (typeof value === 'function') add(key, key + '(', undefined, false);
                else add(key, key, value, false);
            });
            CalqueMath.FUNCTIONS.forEach(function (name) { add(name, name + '(', undefined, false); });
        }

        return {
            from: m.from + m.text.length - partial.length,
            options: options,
            filter: true
        };
    };

    // ---------- Выделение, копирование, ссылка ----------

    // Строки, которые задевает выделение. Без выделения — все строки
    Calque.prototype.selectedLines = function () {
        var r = this.view.state.selection.main;
        var s = r.from, e = r.to;
        if (s === e) return this.lines;
        return this.lines.filter(function (line) {
            if (line.code.length === 0) return line.positionStart >= s && line.positionStart < e;
            return Math.min(e, line.positionEnd) - Math.max(s, line.positionStart) > 0;
        });
    };

    // Заменяем обращения вида Вкусности.Орехи на внутренние имена
    Calque.prototype.transform = function (node) {
        var calque = this;

        function pathOf(n) {
            if (n.isSymbolNode) return [n.name];
            if (n.isAccessorNode && n.index && n.index.isObjectProperty && n.index.isObjectProperty()) {
                var p = pathOf(n.object);
                return p ? p.concat([n.index.getObjectProperty()]) : null;
            }
            return null;
        }

        return node.transform(function (n, path, parent) {
            if (parent && parent.isAssignmentNode && path === 'object') return n;
            if (parent && parent.isFunctionNode && path === 'fn') return n;
            if (n.isAccessorNode) {
                var p = pathOf(n);
                var t = p && calque.tree.resolve(p);
                if (t && calque.scope.has(t.key)) return new math.SymbolNode(t.key);
            }
            if (n.isSymbolNode && !calque.scope.has(n.name)) {
                var r = calque.tree.resolve([n.name]);
                if (r && calque.scope.has(r.key)) return new math.SymbolNode(r.key);
            }
            return n;
        });
    };

    // «имя := выражение» — значение, которое не попадает в суммы групп
    var NOSUM_RE = /^(\s*)([\p{L}_][\p{L}\p{N}_]*)\s*:=(.*)$/u;

    // «_имя = выражение» внутри группы — формула. Считается, когда группа закрыта,
    // поэтому порядок строк не важен. «(%)» в конце дописывает к значению знак %
    var FORMULA_RE = /^\s*(__?)([\p{L}][\p{L}\p{N}_]*)\s*=\s*(.+?)\s*(\(%\))?\s*$/u;
    // «_имя» без выражения в строке таблицы — показать здесь формулу группы
    var INHERIT_RE = /^\s*__?([\p{L}][\p{L}\p{N}_]*)\s*$/u;

    // Поля строки таблицы поверх общей области видимости
    function Overlay(parent, values) { this.p = parent; this.v = values; }
    Overlay.prototype.get = function (k) { return Object.prototype.hasOwnProperty.call(this.v, k) ? this.v[k] : this.p.get(k); };
    Overlay.prototype.has = function (k) { return Object.prototype.hasOwnProperty.call(this.v, k) || this.p.has(k); };
    Overlay.prototype.set = function (k, v) { this.v[k] = v; return this; };
    Overlay.prototype.keys = function () { return Object.keys(this.v).concat(Array.from(this.p.keys()))[Symbol.iterator](); };
    Overlay.prototype.delete = function (k) { return delete this.v[k]; };

    function addValues(a, b) {
        return a === undefined ? b : math.add(a, b);
    }

    // math.js не сокращает одинаковые единицы: 100 г × 15 ккал/(100 г) хранится как г·ккал/г.
    // Сокращаем сами, иначе дальше деление даёт км²/сут²
    function tidy(v) {
        if (!v || !v.isUnit || !v.units || v.units.length < 2) return v;
        var merged = [], index = {};
        v.units.forEach(function (u) {
            var key = u.unit.name + '|' + u.prefix.name;
            if (key in index) merged[index[key]].power += u.power;
            else { index[key] = merged.length; merged.push({ unit: u.unit, prefix: u.prefix, power: u.power }); }
        });
        merged = merged.filter(function (u) { return Math.abs(u.power) > 1e-12; });
        if (merged.length === v.units.length) return v;
        if (!merged.length) return v.value;
        var r = v.clone();
        r.units = merged;
        return r;
    }

    // Делим строку на код и комментарий в конце: «вес = 100 # граммы»
    function splitComment(code) {
        var quote = null;
        for (var i = 0; i < code.length; i++) {
            var ch = code[i];
            if (quote) { if (ch === quote) quote = null; continue; }
            if (ch === '"' || ch === "'") quote = ch;
            else if (ch === '#') return { code: code.slice(0, i).replace(/\s+$/, ''), comment: code.slice(i) };
        }
        return { code: code, comment: '' };
    }

    // Имена переменных в выражении, без функций, единиц и констант
    function symbolsOf(node) {
        var names = {};
        node.traverse(function (n, path, parent) {
            if (!n.isSymbolNode) return;
            if (parent && parent.isFunctionNode && path === 'fn') return;
            names[n.name] = true;
        });
        return Object.keys(names);
    }

    Calque.prototype.recalc = function () {
        var calque = this;

        calque.lines = [];
        calque.tree = new Tree();
        calque.suffix = {};
        calque.defs = {};
        var scope = calque.scope = new Map();
        scope.set('last', null);

        var stack = [];

        function setGroupValue(g, value) {
            scope.set(g.name, value);
            scope.set(g.node.key, value);
        }

        // Поля группы: её именованные значения и формулы или итоги, если она сама таблица
        function fieldsOf(g) {
            if (g.fields) return g.fields;
            var f = {};
            g.leaves.forEach(function (l) { if (l.fieldName) f[l.fieldName] = l.result; });
            return f;
        }

        // Считаем формулы в области values. Несколько проходов — формулы могут ссылаться друг на друга
        function evaluateFormulas(formulas, values, onResult, onError) {
            var pending = formulas.slice(), errors = {};
            for (var pass = 0; pass <= formulas.length && pending.length; pass++) {
                var next = [];
                pending.forEach(function (f) {
                    try {
                        var v = tidy(calque.transform(f.node).compile().evaluate(new Overlay(scope, values)));
                        values[f.name] = v;
                        onResult(f, v);
                    } catch (e) {
                        errors[f.name] = e.message || e.toString();
                        next.push(f);
                    }
                });
                if (next.length === pending.length) break;
                pending = next;
            }
            pending.forEach(function (f) { onError(f, errors[f.name]); });
        }

        function closeGroup(g) {
            var line = g.line;
            line.closed = true;

            if (g.formulas.length && !g.groups.length) {
                // Формулы строки: считаются по её собственным значениям
                evaluateFormulas(g.formulas, Object.assign({}, g.named), function (f, v) {
                    f.line.result = v;
                    f.line.fieldName = f.name;
                    g.named[f.name] = v;
                    g.leaves.push(f.line);
                    var n = calque.tree.add(g.path.concat([f.name]), f.line);
                    scope.set(n.key, v);
                }, function (f, err) {
                    f.line.error = err;
                });
            } else if (g.formulas.length) {
                // Формулы таблицы: считаются для каждой строки
                g.groups.forEach(function (c) {
                    var values = Object.assign({}, c.named, fieldsOf(c));
                    c.computed = {};
                    var applicable = g.formulas.filter(function (f) { return !c.own[f.name]; });
                    evaluateFormulas(applicable, values, function (f, v) {
                        c.computed[f.name] = v;
                        c.named[f.name] = v;
                        var n = calque.tree.add(c.path.concat([f.name]), c.line);
                        scope.set(n.key, v);
                    }, function (f, err) {
                        c.line.rowError = f.name + ': ' + err;
                    });
                    if (c.fields) Object.assign(c.fields, c.computed);
                });
            }

            function rowFields(c) {
                var f = Object.assign({}, fieldsOf(c));
                if (c.computed) Object.assign(f, c.computed);
                return f;
            }

            // Таблица: у соседних подгрупп повторяются имена полей или у неё есть формулы
            var count = {};
            g.groups.forEach(function (c) {
                Object.keys(rowFields(c)).forEach(function (k) { count[k] = (count[k] || 0) + 1; });
            });
            var tableFormulas = g.groups.length > 0 && g.formulas.length > 0;
            var isTable = tableFormulas || Object.keys(count).some(function (k) { return count[k] >= 2; });

            if (isTable) {
                var fields = {};
                var add = function (name, value) {
                    try { fields[name] = addValues(fields[name], value); }
                    catch (e) { g.error = 'Поле «' + name + '»: ' + (e.message || e); }
                };
                g.groups.forEach(function (c) {
                    var cf = rowFields(c);
                    Object.keys(cf).forEach(function (k) { add(k, cf[k]); });
                });
                g.leaves.forEach(function (l) { if (l.fieldName) add(l.fieldName, l.result); });

                // Итог формулы — по итогам полей, если все её поля есть в итогах.
                // Так отношения вроде ккал/вес дают среднее, а не сумму долей
                if (tableFormulas) {
                    var rowNames = {};
                    g.groups.forEach(function (c) { Object.keys(c.named).forEach(function (k) { rowNames[k] = true; }); });
                    g.formulas.forEach(function (f) {
                        var ok = symbolsOf(f.node).every(function (name) {
                            if (Object.prototype.hasOwnProperty.call(fields, name)) return true;
                            return !rowNames[name];
                        });
                        if (!ok) return;
                        try {
                            fields[f.name] = tidy(calque.transform(f.node).compile().evaluate(new Overlay(scope, Object.assign({}, fields))));
                        } catch (e) { /* остаётся сумма по строкам */ }
                    });
                    g.formulas.forEach(function (f) {
                        f.line.result = fields[f.name];
                        f.line.isTotal = true;
                    });
                }

                g.fields = fields;
                line.fields = fields;
                line.result = undefined;
                setGroupValue(g, Object.assign({}, fields));

                Object.keys(fields).forEach(function (k) {
                    var n = calque.tree.add(g.path.concat([k]), line);
                    scope.set(n.key, fields[k]);
                });

                // Подгруппы становятся строками таблицы
                g.groups.forEach(function (c) {
                    if (c.fields) return;
                    c.line.record = true;
                    c.line.result = undefined;
                    c.error = null;
                    c.line.groupError = null;
                    setGroupValue(c, rowFields(c));
                    c.leaves.forEach(function (l) { if (l.fieldName) l.pctBase = fields[l.fieldName]; });
                    var shown = {};
                    g.formulas.forEach(function (f) {
                        if (f.rows && c.computed && c.computed[f.name] !== undefined) shown[f.name] = c.computed[f.name];
                    });
                    c.line.rowFields = Object.keys(shown).length ? shown : null;
                    c.line.rowBases = fields;

                    // «_имя» в строке: значение формулы группы для этой строки
                    c.inherits.forEach(function (l) {
                        if (c.computed && c.computed[l.formula] !== undefined) {
                            l.result = c.computed[l.formula];
                            l.pctBase = fields[l.formula];
                        } else if (!c.own[l.formula]) {
                            l.error = 'У группы «' + g.name + '» нет формулы «_' + l.formula + '»';
                        }
                    });
                });
                g.leaves.forEach(function (l) { if (l.fieldName) l.pctBase = fields[l.fieldName]; });
            } else if (g.formulas.length) {
                // Запись: поля и формулы, складывать их между собой бессмысленно
                line.record = true;
                line.result = undefined;
                setGroupValue(g, fieldsOf(g));
                line.rowFields = null;
            } else {
                var sum;
                var items = g.leaves.slice();
                g.groups.forEach(function (c) { if (!c.fields) items.push(c.line); });
                items.forEach(function (l) {
                    try { sum = addValues(sum, l.result); }
                    catch (e) { g.error = e.message || e.toString(); }
                });
                if (sum === undefined) sum = 0;
                line.result = sum;
                setGroupValue(g, sum);
                items.forEach(function (l) { l.pctBase = sum; });
            }

            line.groupError = g.error;

        }

        function closeUntil(indent) {
            while (stack.length && stack[stack.length - 1].indent >= indent) closeGroup(stack.pop());
        }

        var position = 0;
        calque.raw.split('\n').forEach(function (code, index) {
            var line = {
                index: index,
                code: code,
                positionStart: position,
                positionEnd: position + code.length,
                result: undefined,
                error: null,
                indent: 0,
                summing: null,
                closed: false,
                noSum: false,
                fieldName: null,
                pctBase: undefined
            };

            position += code.length + 1;
            calque.lines.push(line);

            var spaces = code.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
            line.indent = Math.floor(spaces / 2);

            closeUntil(line.indent);
            var parent = stack.length ? stack[stack.length - 1] : null;

            var bare = splitComment(code).code;
            var trimmed = bare.trim();

            if (trimmed.slice(-1) === ':' && trimmed.length > 1) {
                line.summing = trimmed.slice(0, -1).trim();
                line.children = [];
                var path = (parent ? parent.path : []).concat([line.summing]);
                var node = calque.tree.add(path, line);
                var g = { line: line, indent: line.indent, name: line.summing, path: path, node: node, leaves: [], groups: [], named: {}, formulas: [], own: {}, inherits: [], error: null };
                if (parent) parent.groups.push(g);
                stack.push(g);
                return;
            }

            stack.forEach(function (g) { g.line.children.push(line); });

            // Формула группы: запоминаем, посчитаем при закрытии группы
            var fm = parent && bare.match(FORMULA_RE);
            if (fm) {
                try {
                    var key = 'formula:' + fm[3];
                    if (!calque.cache[key]) calque.cache[key] = { parsed: math.parse(fm[3]) };
                    line.formula = fm[2];
                    line.parsed = calque.cache[key].parsed;
                    if (fm[4]) calque.suffix[fm[2]] = '%';
                    parent.formulas.push({ name: fm[2], node: line.parsed, line: line, rows: fm[1] === '__' });
                    parent.own[fm[2]] = true;
                } catch (e) {
                    line.error = e.message || e.toString();
                }
                return;
            }
            var im = parent && bare.match(INHERIT_RE);
            if (im) {
                line.formula = im[1];
                line.inherit = true;
                parent.inherits.push(line);
                return;
            }

            var source = bare;
            var m = bare.match(NOSUM_RE);
            if (m) {
                source = m[1] + m[2] + ' =' + m[3];
                line.noSum = true;
            }

            try {
                var cached = calque.cache[source];
                if (!cached) {
                    cached = { parsed: math.parse(source) };
                    calque.cache[source] = cached;
                }
                line.parsed = cached.parsed;
                line.result = tidy(calque.transform(cached.parsed).compile().evaluate(scope));
            } catch (e) {
                line.error = e.message || e.toString();
            }

            if (line.result === undefined) return;

            var named = line.parsed && line.parsed.isAssignmentNode && line.parsed.object.isSymbolNode;
            if (named) calque.defs[line.parsed.object.name] = line;
            if (line.parsed && line.parsed.isFunctionAssignmentNode) calque.defs[line.parsed.name] = line;

            // Значение внутри группы доступно и по полному пути
            if (parent && named) {
                var leaf = calque.tree.add(parent.path.concat([line.parsed.object.name]), line);
                scope.set(leaf.key, line.result);
                parent.named[line.parsed.object.name] = line.result;
            }

            if (parent && typeof line.result !== 'function' && !line.noSum) {
                parent.leaves.push(line);
                if (named) line.fieldName = line.parsed.object.name;
            }

            scope.set('last', line.result);
        });

        closeUntil(0);
        while (stack.length) closeGroup(stack.pop());

        // «_имя», которому не нашлось формулы у родительской таблицы
        calque.lines.forEach(function (l) {
            if (l.inherit && l.result === undefined && !l.error) {
                l.error = 'Формулы «_' + l.formula + '» нет у родительской группы';
            }
        });
    };

    // Число с единицей вроде «100 г» или «15 ккал / (100 г)» — без переменных
    function isPlainQuantity(node) {
        var plain = true;
        node.traverse(function (n) {
            if (n.isSymbolNode && !(n.name in math) && !math.Unit.isValuelessUnit(n.name)) plain = false;
            if (n.isFunctionNode || n.isAccessorNode) plain = false;
        });
        return plain;
    }

    // Доля a от b: числа или величины одной размерности
    function ratio(a, b) {
        try {
            if (a === undefined || b === undefined || typeof a === 'function') return null;
            var r = math.divide(a, b);
            return isNumeric(r) ? r : null;
        } catch (e) {
            return null;
        }
    }

    Calque.prototype.describeLine = function (line) {
        var type, data = '';
        var error = line.error || line.rowError || (line.summing && !line.record ? line.groupError : null);

        if (error) {
            if (line.selected) type = 'empty';
            else if (line.summing && line.children.find(function (l) { return l.error; })) type = 'empty';
            else type = 'error';
        } else if (line.summing) {
            type = line.record && !line.rowFields ? 'empty' : 'result';
        } else if (line.result === undefined || typeof line.result === 'function') {
            type = 'empty';
        } else if (line.formula) {
            type = 'result';
        } else if (line.parsed.isFunctionAssignmentNode) {
            type = 'empty';
        } else if (line.parsed.isConstantNode) {
            type = 'empty';
        } else if (line.parsed.isAssignmentNode && line.parsed.value.isConstantNode) {
            type = 'empty';
        } else if (line.parsed.isAssignmentNode && isPlainQuantity(line.parsed.value) &&
            formatValue(line.result).replace(/[\s\u00a0]/g, '') === line.parsed.value.toString().replace(/\s/g, '')) {
            type = 'empty';
        } else {
            type = 'result';
        }

        if (type === 'result') {
            var calque = this;
            var fmt = function (k, v) {
                if (calque.suffix[k] === '%' && isNumeric(v)) return formatPercent(v);
                return formatValue(v) + (calque.suffix[k] || '');
            };
            if (line.rowFields) {
                data = Object.keys(line.rowFields).map(function (k) {
                    var v = k + ' ' + fmt(k, line.rowFields[k]);
                    var r = line.rowBases ? ratio(line.rowFields[k], line.rowBases[k]) : null;
                    return r !== null && isFinite(r) ? v + ' (' + formatPercent(r * 100) + ')' : v;
                }).join(' · ');
            } else if (line.fields) {
                data = Object.keys(line.fields).map(function (k) {
                    return k + ' ' + fmt(k, line.fields[k]);
                }).join(' · ');
            } else {
                data = line.formula ? fmt(line.formula, line.result) : formatValue(line.result);
            }
        } else if (type === 'error') {
            data = error;
        }

        // Доля в группе: в обычной группе — от её итога, в таблице — от итога столбца
        var percent = '';
        if (type !== 'error' && !line.noSum && !line.isTotal && line.pctBase !== undefined) {
            var r = ratio(line.result, line.pctBase);
            if (r !== null && isFinite(r) && line.pctBase !== 0) percent = formatPercent(r * 100);
        }

        var prefix = ' ';
        if (type === 'result') prefix += line.fields || line.rowFields ? '' : '= ';
        else if (type === 'error') prefix += '// ';

        if (percent) {
            if (type === 'result') data += ' · ' + percent;
            else { type = 'percent'; data = percent; prefix = ' · '; }
        }

        return { type: type, prefix: prefix, data: data.replace(/\n/g, '\\n') };
    };

    // Текст с результатами — для пересылки
    Calque.prototype.toText = function (lines) {
        var calque = this;
        lines = lines || calque.lines;
        // Убираем общий отступ, если скопирована часть группы
        var common = Infinity;
        lines.forEach(function (line) {
            if (line.code.trim()) common = Math.min(common, line.code.match(/^ */)[0].length);
        });
        if (!isFinite(common)) common = 0;
        var rows = lines.map(function (line) {
            var d = calque.describeLine(line);
            var show = d.type === 'result' || d.type === 'percent';
            return { code: line.code.substring(common).replace(/\s+$/, ''), tail: show ? (d.prefix.trim() ? d.prefix.trim() + ' ' : '') + d.data : '' };
        });
        var width = 0;
        rows.forEach(function (r) { if (r.tail) width = Math.max(width, r.code.length); });
        width = Math.min(width, 40);
        return rows.map(function (r) {
            if (!r.tail) return r.code;
            var pad = Math.max(1, width - r.code.length + 2);
            return r.code + new Array(pad + 1).join(' ') + r.tail;
        }).join('\n').replace(/ /g, ' ');
    };

    Calque.prototype.shareLink = function () {
        var base = location.href.split('#')[0];
        return encodeText(this.getText()).then(function (h) { return base + '#' + h; });
    };

    // ---------- Панель ----------

    function keepFocus(el) {
        el.addEventListener('mousedown', function (e) { e.preventDefault(); });
        el.addEventListener('touchstart', function () {}, { passive: true });
    }

    Calque.prototype.stepAtCaret = function (direction, big) {
        var state = this.view.state;
        var target = selectionNumber(state);
        if (!target) {
            var head = state.selection.main.head;
            var line = state.doc.lineAt(head);
            target = numberAt(state.doc.toString(), line.from, head);
        }
        if (!target) {
            this.toast('Поставьте курсор на число');
            return;
        }
        this.replaceRange(target.start, target.end, stepNumber(target.text, direction, big), true);
    };

    Calque.prototype.updateHistoryButtons = function () {
        if (!this.undoButton) return;
        this.undoButton.disabled = CM.undoDepth(this.view.state) === 0;
        this.redoButton.disabled = CM.redoDepth(this.view.state) === 0;
    };

    Calque.prototype.toast = function (message) {
        var calque = this;
        if (!calque.toastEl) {
            calque.toastEl = document.createElement('div');
            calque.toastEl.className = 'calque-toast';
            document.body.appendChild(calque.toastEl);
        }
        calque.toastEl.textContent = message;
        calque.toastEl.classList.add('visible');
        clearTimeout(calque.toastTimer);
        calque.toastTimer = setTimeout(function () { calque.toastEl.classList.remove('visible'); }, 1800);
    };

    Calque.prototype.buildToolbar = function (container) {
        var calque = this;
        container.classList.add('calque-toolbar');

        var buttons = document.createElement('div');
        buttons.className = 'buttons';
        container.appendChild(buttons);

        function button(label, title, action, cls) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.title = title;
            if (cls) b.className = cls;
            keepFocus(b);
            b.onclick = action;
            buttons.appendChild(b);
            return b;
        }

        calque.undoButton = button('↶', 'Отменить', function () { CM.undo(calque.view); });
        calque.redoButton = button('↷', 'Повторить', function () { CM.redo(calque.view); });
        button('−10', 'Уменьшить число на 10 шагов', function () { calque.stepAtCaret(-1, true); }, 'gap');
        button('−1', 'Уменьшить число', function () { calque.stepAtCaret(-1, false); });
        button('+1', 'Увеличить число', function () { calque.stepAtCaret(1, false); });
        button('+10', 'Увеличить число на 10 шагов', function () { calque.stepAtCaret(1, true); });
        button('⇤', 'Убрать отступ', function () { calque.removeIndent(); }, 'gap');
        button('⇥', 'Добавить отступ', function () { calque.addIndent(); });
        button('⧉', 'Скопировать выделенное с итогами, без выделения — весь расчёт', function () {
            var lines = calque.selectedLines();
            var all = lines === calque.lines;
            copyText(calque.toText(lines)).then(function () {
                calque.toast(all ? 'Скопирован весь расчёт' : 'Скопировано строк: ' + lines.length);
            });
        }, 'gap');
        button('🔗', 'Скопировать ссылку на этот расчёт', function () {
            calque.shareLink().then(function (url) {
                return copyText(url).then(function () { calque.toast('Ссылка скопирована'); });
            });
        });

        calque.updateHistoryButtons();

        // Держим панель над экранной клавиатурой
        if (window.visualViewport) {
            var place = function () {
                var vv = window.visualViewport;
                var offset = window.innerHeight - vv.height - vv.offsetTop;
                container.style.bottom = Math.max(0, offset) + 'px';
            };
            window.visualViewport.addEventListener('resize', place);
            window.visualViewport.addEventListener('scroll', place);
            place();
        }
    };

    Calque.encodeText = encodeText;
    Calque.decodeText = decodeText;
    Calque.math = math;

    window.Calque = Calque;
})();
