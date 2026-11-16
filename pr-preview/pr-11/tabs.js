// Вкладки: несколько расчётов в одном браузере
(function () {
    var STORE = 'calque_docs';

    function load() {
        try {
            var data = JSON.parse(localStorage.getItem(STORE));
            if (data && data.docs && data.docs.length) return data;
        } catch (e) { /* нет данных или приватный режим */ }
        return null;
    }

    var SETTINGS = 'calque_settings';

    function loadSettings() {
        try { return JSON.parse(localStorage.getItem(SETTINGS)) || {}; } catch (e) { return {}; }
    }

    function saveSettings(settings) {
        try { localStorage.setItem(SETTINGS, JSON.stringify(settings)); } catch (e) { /* ничего */ }
    }

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // Название — первая непустая строка без решётки
    function titleOf(text) {
        var line = (text.split('\n').find(function (l) { return l.trim(); }) || '').replace(/^\s*#\s*/, '').trim();
        if (!line) return 'Без названия';
        return line.length > 24 ? line.slice(0, 23) + '…' : line;
    }

    function Tabs(barEl, calque, data) {
        this.bar = barEl;
        this.calque = calque;
        this.data = data;
        this.scroll = {};
        this.render();
    }

    Tabs.prototype.save = function () {
        try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch (e) { /* ничего */ }
    };

    Tabs.prototype.active = function () {
        var id = this.data.active;
        return this.data.docs.find(function (d) { return d.id === id; }) || this.data.docs[0];
    };

    Tabs.prototype.onChange = function (text) {
        var doc = this.active();
        if (!doc || doc.text === text) return;
        doc.text = text;
        this.save();
        var el = this.bar.querySelector('.tab[data-id="' + doc.id + '"] .tab-title');
        if (el) el.textContent = titleOf(text);
    };

    Tabs.prototype.open = function (id) {
        var current = this.active();
        if (current) this.scroll[current.id] = window.scrollY;
        this.data.active = id;
        this.save();
        this.calque.setText(this.active().text);
        this.render();
        window.scrollTo(0, this.scroll[id] || 0);
        this.calque.focus();
    };

    Tabs.prototype.add = function (text) {
        var doc = { id: newId(), text: text };
        this.data.docs.push(doc);
        this.open(doc.id);
        if (text === '') this.calque.focus();
    };

    // Справка — отдельная вкладка. Открываем её в исходном виде, даже если её правили
    Tabs.prototype.openHelp = function () {
        var doc = this.data.docs.find(function (d) { return d.help; });
        if (doc) {
            doc.text = this.helpText;
            this.open(doc.id);
        } else {
            doc = { id: newId(), text: this.helpText, help: true };
            this.data.docs.push(doc);
            this.open(doc.id);
        }
        window.scrollTo(0, 0);
    };

    Tabs.prototype.close = function (id) {
        var docs = this.data.docs;
        var i = docs.findIndex(function (d) { return d.id === id; });
        if (i < 0) return;
        var doc = docs[i];
        if (doc.text.trim() && !window.confirm('Удалить «' + titleOf(doc.text) + '»?')) return;
        docs.splice(i, 1);
        if (!docs.length) docs.push({ id: newId(), text: '' });
        var next = docs[Math.min(i, docs.length - 1)];
        if (this.data.active === id) {
            this.open(next.id);
        } else {
            this.save();
            this.render();
        }
    };

    Tabs.prototype.render = function () {
        var tabs = this;
        tabs.bar.innerHTML = '';
        var bar = document.createElement('div');
        bar.className = 'tab-list';
        tabs.bar.appendChild(bar);
        var activeId = tabs.active().id;

        tabs.data.docs.forEach(function (doc) {
            var tab = document.createElement('div');
            tab.className = 'tab' + (doc.id === activeId ? ' active' : '');
            tab.dataset.id = doc.id;

            var title = document.createElement('span');
            title.className = 'tab-title';
            title.textContent = titleOf(doc.text);
            tab.appendChild(title);

            if (doc.id === activeId) {
                var x = document.createElement('button');
                x.type = 'button';
                x.className = 'tab-close';
                x.textContent = '×';
                x.title = 'Закрыть вкладку';
                x.onmousedown = function (e) { e.preventDefault(); };
                x.onclick = function (e) { e.stopPropagation(); tabs.close(doc.id); };
                tab.appendChild(x);
            }

            tab.onmousedown = function (e) { e.preventDefault(); };
            tab.onclick = function () { if (doc.id !== tabs.active().id) tabs.open(doc.id); };
            bar.appendChild(tab);
        });

        var plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'tab-add';
        plus.textContent = '+';
        plus.title = 'Новый расчёт';
        plus.onmousedown = function (e) { e.preventDefault(); };
        plus.onclick = function () { tabs.add(''); };
        tabs.bar.appendChild(plus);

        var more = document.createElement('button');
        more.type = 'button';
        more.className = 'tab-menu';
        more.textContent = '⋯';
        more.title = 'Сохранить или открыть файл';
        more.onmousedown = function (e) { e.preventDefault(); };
        more.onclick = function (e) { e.stopPropagation(); tabs.toggleMenu(more); };
        tabs.bar.appendChild(more);

        var active = bar.querySelector('.tab.active');
        if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    // ---------- Файлы ----------

    function pipeBytes(bytes, stream) {
        return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()
            .then(function (b) { return new Uint8Array(b); });
    }

    function today() {
        var d = new Date();
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function download(bytes, name, type) {
        var url = URL.createObjectURL(new Blob([bytes], { type: type }));
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    }

    Tabs.prototype.exportAll = function () {
        var tabs = this;
        var json = JSON.stringify({
            app: 'calque',
            version: 1,
            exported: new Date().toISOString(),
            docs: tabs.data.docs.map(function (d) { return { title: titleOf(d.text), text: d.text }; })
        }, null, 1);
        var bytes = new TextEncoder().encode(json);
        if (typeof CompressionStream === 'undefined') {
            download(bytes, 'calque-' + today() + '.json', 'application/json');
            tabs.calque.toast('Сохранено без сжатия: браузер не умеет gzip');
            return;
        }
        pipeBytes(bytes, new CompressionStream('gzip')).then(function (gz) {
            download(gz, 'calque-' + today() + '.json.gz', 'application/gzip');
            tabs.calque.toast('Сохранено вкладок: ' + tabs.data.docs.length);
        });
    };

    // Читаем .json.gz, .json или .txt: сначала проверяем подпись gzip, потом JSON
    function readFile(file) {
        return file.arrayBuffer().then(function (buf) {
            var bytes = new Uint8Array(buf);
            if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
                return pipeBytes(bytes, new DecompressionStream('gzip'));
            }
            return bytes;
        }).then(function (bytes) {
            var text = new TextDecoder().decode(bytes);
            try {
                var data = JSON.parse(text);
                if (data && Array.isArray(data.docs)) {
                    return data.docs.map(function (d) { return String(d.text || ''); });
                }
            } catch (e) { /* не JSON — значит, обычный текст */ }
            return [text.replace(/\r\n/g, '\n')];
        });
    }

    Tabs.prototype.importFiles = function (files) {
        var tabs = this;
        Promise.all(Array.prototype.map.call(files, readFile)).then(function (lists) {
            var added = 0, skipped = 0, lastId = null;
            lists.forEach(function (texts) {
                texts.forEach(function (text) {
                    if (tabs.data.docs.some(function (d) { return d.text === text; })) { skipped++; return; }
                    var doc = { id: newId(), text: text };
                    tabs.data.docs.push(doc);
                    lastId = doc.id;
                    added++;
                });
            });
            if (lastId) tabs.open(lastId);
            var msg = 'Открыто вкладок: ' + added;
            if (skipped) msg += ', уже были: ' + skipped;
            tabs.calque.toast(msg);
        }).catch(function () {
            tabs.calque.toast('Не получилось прочитать файл');
        });
    };

    Tabs.prototype.toggleMenu = function (anchor) {
        var tabs = this;
        if (tabs.menu) { tabs.closeMenu(); return; }

        var menu = document.createElement('div');
        menu.className = 'calque-menu';

        function item(label, action) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.onmousedown = function (e) { e.preventDefault(); };
            b.onclick = function () { tabs.closeMenu(); action(); };
            menu.appendChild(b);
        }

        function toggle(label, key, apply) {
            var on = !!tabs.calque.settings[key];
            item((on ? '✓ ' : '\u2003') + label, function () {
                apply(!on);
                saveSettings(tabs.calque.settings);
                tabs.calque.toast(label + (on ? ': выключено' : ': включено'));
            });
        }

        toggle('Номера строк', 'lineNumbers', function (v) { tabs.calque.setLineNumbers(v); });
        toggle('Автоформат', 'autoFormat', function (v) { tabs.calque.setAutoFormat(v); });
        item('\u2003Отформатировать всё', function () { tabs.calque.formatAll(); });
        var sep = document.createElement('div');
        sep.className = 'calque-menu-sep';
        menu.appendChild(sep);

        item('\u2003Сохранить все вкладки', function () { tabs.exportAll(); });
        item('\u2003Открыть файл…', function () {
            var input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = '.gz,.json,.txt,application/gzip,application/json,text/plain';
            input.onchange = function () { if (input.files.length) tabs.importFiles(input.files); };
            input.click();
        });

        var sep2 = document.createElement('div');
        sep2.className = 'calque-menu-sep';
        menu.appendChild(sep2);
        item('\u2003Справка', function () { tabs.openHelp(); });

        document.body.appendChild(menu);
        var r = anchor.getBoundingClientRect();
        menu.style.top = (r.bottom + 4) + 'px';
        menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
        tabs.menu = menu;

        setTimeout(function () {
            tabs.outside = function (e) { if (!menu.contains(e.target)) tabs.closeMenu(); };
            document.addEventListener('click', tabs.outside);
        });
    };

    Tabs.prototype.closeMenu = function () {
        if (!this.menu) return;
        this.menu.remove();
        this.menu = null;
        document.removeEventListener('click', this.outside);
    };

    // Запуск страницы: вкладки, перенос старого документа, открытие ссылки
    Tabs.start = function (options) {
        var data = load();

        if (!data) {
            var old = null;
            try { old = localStorage.getItem('input'); } catch (e) { /* ничего */ }
            var first = old !== null ? { id: newId(), text: old } : { id: newId(), text: options.help || '', help: true };
            data = { docs: [first], active: first.id };
        }

        var doc = data.docs.find(function (d) { return d.id === data.active; }) || data.docs[0];
        data.active = doc.id;

        var tabs;
        var settings = loadSettings();
        var calque = new Calque(options.editor, {
            lineNumbers: settings.lineNumbers,
            autoFormat: settings.autoFormat,
            toolbar: options.toolbar,
            storageKey: null,
            text: doc.text,
            onChange: function (text) { if (tabs) tabs.onChange(text); }
        });

        tabs = new Tabs(options.bar, calque, data);
        tabs.helpText = options.help || '';
        tabs.save();
        window.calque = calque;
        window.calqueTabs = tabs;

        function openHash() {
            if (location.hash.length <= 3) return;
            Calque.decodeText(location.hash).then(function (shared) {
                history.replaceState(null, '', location.pathname + location.search);
                if (shared === null) return;
                var same = tabs.data.docs.find(function (d) { return d.text === shared; });
                if (same) {
                    tabs.open(same.id);
                    calque.toast('Этот расчёт уже открыт');
                } else {
                    tabs.add(shared);
                    calque.toast('Расчёт из ссылки открыт в новой вкладке');
                }
            });
        }
        openHash();
        // Ссылку могут вставить в адресную строку уже открытой страницы
        window.addEventListener('hashchange', openHash);

        calque.focus();
        return tabs;
    };

    Tabs.titleOf = titleOf;
    window.CalqueTabs = Tabs;
})();
