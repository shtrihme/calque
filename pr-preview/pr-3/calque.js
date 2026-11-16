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

    function Calque(inputEl, outputEl, options) {
        var calque = this;
        options = options || {};

        calque.inputEl = inputEl;
        calque.outputEl = outputEl;
        calque.parentEl = inputEl.parentNode;
        calque.storageKey = options.storageKey === undefined ? 'input' : options.storageKey;
        calque.onChange = options.onChange || null;

        calque.raw = null;
        calque.lines = [];
        calque.cache = {};
        calque.tree = new Tree();
        calque.scope = new Map();

        calque.selection = '';
        calque.selectionStart = 0;
        calque.selectionEnd = 0;

        calque.suggestions = [];
        calque.suggestionsHidden = false;

        if (options.toolbar) calque.buildToolbar(options.toolbar);

        var last = 0;
        var handler = function () {
            if (last === Date.now()) return;
            else last = Date.now();

            calque.input();
            calque.inputEl.style.height = Math.max(calque.outputEl.clientHeight, calque.parentEl.clientHeight) + 'px';
        };
        calque.handler = handler;

        handler();

        calque.inputEl.oninput = function () {
            calque.suggestionsHidden = false;
            handler();
        };

        calque.inputEl.onmousedown = function () {
            window.requestAnimationFrame(handler);
        };

        calque.inputEl.onkeydown = function (event) {
            if (event.key === 'Escape') {
                calque.suggestionsHidden = true;
                calque.renderSuggestions();
            }

            if (event.key === 'Enter') {
                var line = calque.lines.filter(function (line) { return line.selected; }).pop();

                var insert = '\n';
                if (line && line.summing) insert += '  ';
                if (line) for (var i = 0; i < line.indent; i++) insert += '  ';

                calque.replaceSelection(insert, false);
                event.preventDefault();
            }

            if (event.metaKey || event.ctrlKey) {
                if (event.key === 'd' || event.key === 'в') {
                    calque.duplicateSelection();
                    event.preventDefault();
                }
            }

            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                var selection = calque.raw.substring(calque.inputEl.selectionStart, calque.inputEl.selectionEnd);

                if (selection.match(/^-?\d+(\.\d+)?$/)) {
                    var dir = event.key === 'ArrowUp' ? 1 : -1;
                    calque.replaceSelection(stepNumber(selection, dir, event.shiftKey));
                    event.preventDefault();
                }
            }

            if (event.key === 'Tab') {
                if (!event.shiftKey && calque.suggestions.length && !calque.suggestionsHidden) {
                    calque.applySuggestion(calque.suggestions[0]);
                } else if (event.shiftKey) {
                    calque.removeIndent();
                } else {
                    calque.addIndent();
                }

                event.preventDefault();
            }

            window.requestAnimationFrame(handler);
        };

        setTimeout(function fn() {
            setTimeout(fn, 50);
            handler();
        });

        calque.outputEl.scrollTop = calque.inputEl.scrollTop;
    }

    // Подменить весь текст, например при переключении вкладки
    Calque.prototype.setText = function (text) {
        this.inputEl.value = text;
        this.inputEl.setSelectionRange(0, 0);
        this.suggestionsHidden = true;
        this.input();
        this.inputEl.style.height = Math.max(this.outputEl.clientHeight, this.parentEl.clientHeight) + 'px';
    };

    Calque.prototype.input = function () {
        var calque = this;

        var raw = calque.inputEl.value;
        var selectionStart = calque.inputEl.selectionStart;
        var selectionEnd = calque.inputEl.selectionEnd;
        if (raw !== calque.raw || selectionStart !== calque.selectionStart || selectionEnd !== calque.selectionEnd) {
            var changed = raw !== calque.raw;
            calque.raw = raw;
            if (changed) calque.recalc();
            calque.readSelection();
            calque.repaint();
            calque.updateSuggestions();

            if (changed && calque.onChange) calque.onChange(calque.raw);
            if (changed && calque.storageKey) {
                try { localStorage.setItem(calque.storageKey, calque.raw); } catch (e) { /* приватный режим */ }
            }
        }
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

    Calque.prototype.recalc = function () {
        var calque = this;

        calque.lines = [];
        calque.tree = new Tree();
        var scope = calque.scope = new Map();
        scope.set('last', null);

        var stack = [];

        function closeGroup(g) {
            g.line.closed = true;
            g.line.result = g.sum;
            scope.set(g.name, g.sum);
            scope.set(g.node.key, g.sum);
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
                parentGroup: null
            };

            position += code.length + 1;
            calque.lines.push(line);

            var spaces = code.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
            line.indent = Math.floor(spaces / 2);

            closeUntil(line.indent);
            var parent = stack.length ? stack[stack.length - 1] : null;
            line.parentGroup = parent ? parent.line : null;

            var trimmed = code.trim();

            if (trimmed.slice(-1) === ':' && trimmed.indexOf('#') < 0) {
                line.summing = trimmed.slice(0, -1).trim();
                line.result = 0;
                line.children = [];
                var path = (parent ? parent.path : []).concat([line.summing]);
                var node = calque.tree.add(path, line);
                stack.push({ line: line, indent: line.indent, name: line.summing, path: path, node: node, sum: 0 });
                return;
            }

            try {
                var cached = calque.cache[code];
                if (!cached) {
                    cached = { parsed: math.parse(code) };
                    calque.cache[code] = cached;
                }
                line.parsed = cached.parsed;
                line.result = calque.transform(cached.parsed).compile().evaluate(scope);
            } catch (e) {
                line.error = e.message || e.toString();
            }

            if (line.result === undefined) return;

            // Значение внутри группы доступно и по полному пути
            if (parent && line.parsed && line.parsed.isAssignmentNode && line.parsed.object.isSymbolNode) {
                var leafPath = parent.path.concat([line.parsed.object.name]);
                var leaf = calque.tree.add(leafPath, line);
                scope.set(leaf.key, line.result);
            }

            if (typeof line.result !== 'function') {
                stack.forEach(function (g) {
                    g.line.children.push(line);
                    try {
                        g.sum = math.add(g.sum, line.result);
                    } catch (e) {
                        g.line.error = e.message || e.toString();
                    }
                });
            }

            scope.set('last', line.result);
        });

        closeUntil(0);
        while (stack.length) closeGroup(stack.pop());
    };

    Calque.prototype.readSelection = function () {
        var calque = this;

        calque.selectionStart = calque.inputEl.selectionStart;
        calque.selectionEnd = calque.inputEl.selectionEnd;

        calque.selection = calque.raw.substring(calque.selectionStart, calque.selectionEnd);

        calque.lines.forEach(function (line) {
            line.selected = line.positionEnd >= calque.selectionStart && line.positionStart <= calque.selectionEnd;
        });
    };

    Calque.prototype.replaceSelection = function (replacement, select) {
        var calque = this;

        calque.readSelection();

        select = select === false ? false : true;
        replacement = replacement.toString();

        var newSelectionStart = calque.selectionStart;
        var newSelectionEnd = calque.selectionStart + replacement.length;

        calque.inputEl.focus();
        if (!document.execCommand('insertText', false, replacement)) {
            calque.inputEl.setRangeText(replacement, calque.selectionStart, calque.selectionEnd, 'end');
        }
        calque.input();

        if (select) {
            calque.inputEl.setSelectionRange(newSelectionStart, newSelectionEnd);
        } else {
            calque.inputEl.setSelectionRange(newSelectionEnd, newSelectionEnd);
        }
    };

    Calque.prototype.replaceRange = function (start, end, replacement, select) {
        this.inputEl.focus();
        this.inputEl.setSelectionRange(start, end);
        this.replaceSelection(replacement, select);
    };

    Calque.prototype.duplicateSelection = function () {
        var calque = this;

        if (calque.selection === '') {
            var line = calque.lines.find(function (line) {
                return line.selected;
            });

            calque.inputEl.setSelectionRange(line.positionEnd, line.positionEnd);
            calque.replaceSelection('\n' + line.code);
            calque.inputEl.setSelectionRange(calque.selectionStart, calque.selectionStart);
        } else {
            var selection = calque.selection;

            calque.inputEl.setSelectionRange(calque.selectionEnd, calque.selectionEnd);
            calque.replaceSelection(selection);
            calque.inputEl.setSelectionRange(calque.selectionStart - selection.length, calque.selectionStart);
        }
    };

    Calque.prototype.addIndent = function () {
        var calque = this;
        calque.readSelection();

        var selectionStart = Infinity;
        var selectionEnd = 0;

        var affected = 0;
        var replacement = '';

        calque.lines.forEach(function (line) {
            if (!line.selected) return;

            affected++;
            replacement += '  ' + line.code + '\n';

            if (line.positionStart <= selectionStart) selectionStart = line.positionStart;
            if (line.positionEnd > selectionEnd) selectionEnd = line.positionEnd;
        });

        if (affected === 0) return;

        replacement = replacement.substr(0, replacement.length - 1);

        var newSelectionStart = calque.selectionStart + 2;
        var newSelectionEnd = calque.selectionEnd + affected * 2;

        calque.inputEl.setSelectionRange(selectionStart, selectionEnd);
        calque.replaceSelection(replacement);
        calque.inputEl.setSelectionRange(newSelectionStart, newSelectionEnd);
    };

    Calque.prototype.removeIndent = function () {
        var calque = this;
        calque.readSelection();

        var selectionStart = Infinity;
        var selectionEnd = 0;

        var affected = 0;
        var replacement = '';

        calque.lines.forEach(function (line) {
            if (!line.selected) return;
            if (line.code.substr(0, 2) !== '  ') return;

            affected++;
            replacement += line.code.substr(2) + '\n';

            if (line.positionStart <= selectionStart) selectionStart = line.positionStart;
            if (line.positionEnd > selectionEnd) selectionEnd = line.positionEnd;
        });

        if (affected === 0) return;

        replacement = replacement.substr(0, replacement.length - 1);

        var newSelectionStart = Math.max(selectionStart, calque.selectionStart - 2);
        var newSelectionEnd = Math.max(newSelectionStart, calque.selectionEnd - affected * 2);

        calque.inputEl.setSelectionRange(selectionStart, selectionEnd);
        calque.replaceSelection(replacement);
        calque.inputEl.setSelectionRange(newSelectionStart, newSelectionEnd);
    };

    // Что показывать справа от строки: тип, префикс и текст
    Calque.prototype.describeLine = function (line) {
        var type, data = '';

        if (line.error) {
            if (line.selected) type = 'empty';
            else if (line.summing && line.children.find(function (l) { return l.error; })) type = 'empty';
            else type = 'error';
        } else if (line.summing) {
            type = 'result';
        } else if (line.result === undefined || typeof line.result === 'function') {
            type = 'empty';
        } else if (line.parsed.isFunctionAssignmentNode) {
            type = 'empty';
        } else if (line.parsed.isConstantNode) {
            type = 'empty';
        } else if (line.parsed.isAssignmentNode && line.parsed.value.isConstantNode) {
            type = 'empty';
        } else {
            type = 'result';
        }

        if (type === 'result') data = formatValue(line.result);
        else if (type === 'error') data = line.error;

        // Доля от родительской группы
        var percent = '';
        var parent = line.parentGroup;
        if (type !== 'error' && parent && isNumeric(line.result) && isNumeric(parent.result) && parent.result !== 0 && !line.parsed?.isFunctionAssignmentNode) {
            percent = formatPercent(line.result / parent.result * 100);
        }

        var prefix = ' ';
        if (type === 'result') prefix += '= ';
        else if (type === 'error') prefix += '// ';

        if (percent) {
            if (type === 'result') data += ' · ' + percent;
            else { type = 'percent'; data = percent; prefix = ' · '; }
        }

        return { type: type, prefix: prefix, data: data.replace(/\n/g, '\\n') };
    };

    function escapeAttr(s) {
        return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    Calque.prototype.repaint = function () {
        var calque = this;

        var html = '';

        calque.lines.forEach(function (line) {
            var d = calque.describeLine(line);

            var code = line.code || ' ';
            for (var i = 0; i < line.indent; i++) code = code.replace(/(\| )?  /, '$1| ');

            var type = d.type + (line.selected ? ' highlight' : '');

            html += '<div class="' + type + '">';
            html += '<span class="code" data-code="' + escapeAttr(code) + '"></span>';
            html += '<span class="hint" data-prefix="' + escapeAttr(d.prefix) + '">' + escapeHtml(d.data) + '</span>';
            html += '</div>';
        });

        calque.outputEl.innerHTML = html;
    };

    // Строки, которые задевает выделение. Без выделения — все строки
    Calque.prototype.selectedLines = function () {
        var calque = this;
        var s = calque.inputEl.selectionStart, e = calque.inputEl.selectionEnd;
        if (s === e) return calque.lines;
        return calque.lines.filter(function (line) {
            if (line.code.length === 0) return line.positionStart >= s && line.positionStart < e;
            return Math.min(e, line.positionEnd) - Math.max(s, line.positionStart) > 0;
        });
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
            return { code: line.code.substring(common).replace(/\s+$/, ''), tail: show ? (d.type === 'percent' ? '· ' + d.data : '= ' + d.data) : '' };
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
        return encodeText(this.inputEl.value).then(function (h) { return base + '#' + h; });
    };

    // ---------- Подсказки ----------

    Calque.prototype.updateSuggestions = function () {
        var calque = this;
        calque.suggestions = [];

        if (calque.selectionStart === calque.selectionEnd) {
            var text = calque.raw;
            var caret = calque.selectionStart;
            var lineStart = text.lastIndexOf('\n', caret - 1) + 1;
            var before = text.substring(lineStart, caret);
            var after = text.charAt(caret);
            var m = before.match(/[\p{L}\p{N}_.]+$/u);

            if (m && !/^[\d.]/.test(m[0]) && !/[\p{L}\p{N}_]/u.test(after) && before.indexOf('#') < 0) {
                var token = m[0];
                var segments = token.split('.');
                var partial = segments.pop();
                var lower = partial.toLowerCase();
                var tokenStart = caret - token.length;
                var list = [];

                if (segments.length) {
                    var node = calque.tree.resolve(segments);
                    if (node) {
                        var prefix = node.key + '.';
                        node.children.forEach(function (child) {
                            if (child.name.toLowerCase().indexOf(lower) === 0 && child.name !== partial) {
                                list.push({ label: child.name, insert: prefix + child.name, value: calque.scope.get(child.key), start: tokenStart, end: caret, group: child.children.size > 0 });
                            }
                        });
                    }
                } else if (partial.length >= 1) {
                    var seen = {};
                    var add = function (name, insert, value, group) {
                        if (seen[name] || name === partial) return;
                        if (name.toLowerCase().indexOf(lower) !== 0) return;
                        seen[name] = true;
                        list.push({ label: name, insert: insert, value: value, start: tokenStart, end: caret, group: group });
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

                calque.suggestions = list.slice(0, 30);
            }
        }

        calque.renderSuggestions();
    };

    Calque.prototype.applySuggestion = function (s) {
        var calque = this;
        calque.replaceRange(s.start, s.end, s.insert, false);
        calque.suggestionsHidden = false;
        calque.handler();
    };

    Calque.prototype.renderSuggestions = function () {
        var calque = this;
        if (!calque.hintsEl) return;
        var list = calque.suggestionsHidden ? [] : calque.suggestions;
        calque.hintsEl.innerHTML = '';
        calque.hintsEl.style.display = list.length ? '' : 'none';
        list.forEach(function (s) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip' + (s.group ? ' group' : '');
            var v = formatValue(s.value);
            b.innerHTML = escapeHtml(s.label) + (s.group ? '.' : '') + (v ? ' <span class="chip-value">' + escapeHtml(v) + '</span>' : '');
            keepFocus(b);
            b.onclick = function () {
                calque.applySuggestion(s);
                if (s.group) {
                    // Сразу показываем, что внутри группы
                    calque.replaceSelection('.', false);
                }
            };
            calque.hintsEl.appendChild(b);
        });
    };

    // ---------- Панель ----------

    function keepFocus(el) {
        el.addEventListener('mousedown', function (e) { e.preventDefault(); });
        el.addEventListener('touchstart', function () {}, { passive: true });
    }

    Calque.prototype.stepAtCaret = function (direction, big) {
        var calque = this;
        var el = calque.inputEl;
        var text = el.value;
        var sel = text.substring(el.selectionStart, el.selectionEnd);
        var target;
        if (/^-?\d+(\.\d+)?$/.test(sel)) {
            target = { start: el.selectionStart, end: el.selectionEnd, text: sel };
        } else {
            var lineStart = text.lastIndexOf('\n', el.selectionStart - 1) + 1;
            target = numberAt(text, lineStart, el.selectionStart);
        }
        if (!target) {
            calque.toast('Поставьте курсор на число');
            return;
        }
        calque.replaceRange(target.start, target.end, stepNumber(target.text, direction, big), true);
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

        calque.hintsEl = document.createElement('div');
        calque.hintsEl.className = 'hints';
        calque.hintsEl.style.display = 'none';
        container.appendChild(calque.hintsEl);

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

        button('−10', 'Уменьшить число на 10 шагов', function () { calque.stepAtCaret(-1, true); });
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
