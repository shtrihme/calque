// Настройка math.js для Calque: кириллица в именах и функции научного калькулятора.
(function (root) {
    function setup(base) {
        var math = base.create(base.all);
        // Кириллица в именах переменных
        var isAlpha = math.parse.isAlpha;
        math.parse.isAlpha = function (c, cPrev, cNext) {
            return isAlpha(c, cPrev, cNext) || /[Ѐ-ӿ]/.test(c);
        };

        // Килокалории и русские обозначения единиц
        var isValidAlpha = math.Unit.isValidAlpha;
        math.Unit.isValidAlpha = function (c) { return isValidAlpha(c) || /[\u0400-\u04FF]/.test(c); };
        math.createUnit({
            cal: { definition: '4.184 J', aliases: ['calorie', 'calories'] },
            kcal: { definition: '4184 J' },
            'кал': '1 cal',
            'ккал': '1 kcal',
            'мг': '1 mg',
            'г': '1 g',
            'кг': '1 kg',
            'т': '1 tonne',
            'мл': '1 mL',
            'л': '1 L',
            'мм': '1 mm',
            'см': '1 cm',
            'м': '1 m',
            'км': '1 km',
            'с': '1 s',
            'мин': '1 minute',
            'ч': '1 hour',
            'сут': '1 day'
        }, { override: true });

        function toNum(v) {
            if (typeof v === 'number') return v;
            if (v && v.isUnit) return v.toNumber();
            return math.number(v);
        }

        // Область видимости с одной подменённой переменной
        function VarScope(parent, name, value) {
            this.p = parent; this.n = name; this.v = value;
        }
        VarScope.prototype.get = function (k) { return k === this.n ? this.v : this.p.get(k); };
        VarScope.prototype.has = function (k) { return k === this.n || this.p.has(k); };
        VarScope.prototype.set = function (k, v) { if (k === this.n) this.v = v; else this.p.set(k, v); return this; };
        VarScope.prototype.keys = function () { var a = Array.from(this.p.keys()); a.push(this.n); return a[Symbol.iterator](); };
        VarScope.prototype.delete = function (k) { return this.p.delete ? this.p.delete(k) : false; };

        // Из (выражение, переменная) делает обычную функцию f(x)
        function makeFn(exprNode, varNode, scope) {
            if (!varNode || !varNode.isSymbolNode) throw new Error('Второй аргумент — имя переменной, например x');
            var node = exprNode;
            if (node.isOperatorNode && node.fn === 'equal') {
                node = new math.OperatorNode('-', 'subtract', [node.args[0], node.args[1]]);
            }
            var code = node.compile();
            var s = new VarScope(scope, varNode.name, 0);
            return function (x) { s.v = x; return toNum(code.evaluate(s)); };
        }

        function ev(node, scope) { return node.compile().evaluate(scope); }

        function simpson(f, a, b, eps, depth) {
            function rec(a, b, fa, fm, fb, whole, eps, depth) {
                var m = (a + b) / 2, lm = (a + m) / 2, rm = (m + b) / 2;
                var flm = f(lm), frm = f(rm);
                var left = (m - a) / 6 * (fa + 4 * flm + fm);
                var right = (b - m) / 6 * (fm + 4 * frm + fb);
                var delta = left + right - whole;
                if (depth <= 0 || Math.abs(delta) <= 15 * eps) return left + right + delta / 15;
                return rec(a, m, fa, flm, fm, left, eps / 2, depth - 1) + rec(m, b, fm, frm, fb, right, eps / 2, depth - 1);
            }
            var fa = f(a), fb = f(b), fm = f((a + b) / 2);
            return rec(a, b, fa, fm, fb, (b - a) / 6 * (fa + 4 * fm + fb), eps, depth);
        }

        function integral(args, m, scope) {
            if (args.length !== 4) throw new Error('integral(выражение, x, от, до)');
            var f = makeFn(args[0], args[1], scope);
            var a = toNum(ev(args[2], scope)), b = toNum(ev(args[3], scope));
            if (a === b) return 0;
            var sign = 1;
            if (a > b) { var t = a; a = b; b = t; sign = -1; }
            // Разбиваем на куски, чтобы не пропустить узкие пики
            var n = 16, h = (b - a) / n, sum = 0;
            for (var i = 0; i < n; i++) sum += simpson(f, a + i * h, a + (i + 1) * h, 1e-12, 40);
            return sign * sum;
        }
        integral.rawArgs = true;

        function ddx(args, m, scope) {
            if (args.length !== 3) throw new Error('ddx(выражение, x, точка)');
            var f = makeFn(args[0], args[1], scope);
            var x = toNum(ev(args[2], scope));
            var h = 1e-3 * Math.max(1, Math.abs(x));
            return (-f(x + 2 * h) + 8 * f(x + h) - 8 * f(x - h) + f(x - 2 * h)) / (12 * h);
        }
        ddx.rawArgs = true;

        function series(op) {
            var fn = function (args, m, scope) {
                if (args.length !== 4) throw new Error((op === 'sum' ? 'Σ' : 'Π') + '(выражение, x, от, до)');
                var f = makeFn(args[0], args[1], scope);
                var a = Math.round(toNum(ev(args[2], scope))), b = Math.round(toNum(ev(args[3], scope)));
                if (b - a > 1e6) throw new Error('Слишком много слагаемых');
                var r = op === 'sum' ? 0 : 1;
                for (var i = a; i <= b; i++) r = op === 'sum' ? r + f(i) : r * f(i);
                return r;
            };
            fn.rawArgs = true;
            return fn;
        }

        function solve(args, m, scope) {
            if (args.length < 2 || args.length > 3) throw new Error('solve(уравнение, x, начальное значение)');
            var f = makeFn(args[0], args[1], scope);
            var x = args.length === 3 ? toNum(ev(args[2], scope)) : 0;
            for (var i = 0; i < 200; i++) {
                var fx = f(x);
                if (fx === 0) return x;
                var h = 1e-7 * Math.max(1, Math.abs(x));
                var d = (f(x + h) - f(x - h)) / (2 * h);
                if (!isFinite(d) || d === 0) { x += h * 1000 + 0.1; continue; }
                var nx = x - fx / d;
                if (Math.abs(nx - x) <= 1e-13 * Math.max(1, Math.abs(nx))) return nx;
                x = nx;
            }
            if (Math.abs(f(x)) < 1e-9) return x;
            throw new Error('Не нашёл корень, попробуйте другое начальное значение');
        }
        solve.rawArgs = true;

        // Корни многочлена, коэффициенты от старшей степени: roots(1, -3, 2) → x² − 3x + 2
        function roots() {
            var c = Array.prototype.slice.call(arguments).map(toNum);
            while (c.length && c[0] === 0) c.shift();
            var n = c.length - 1;
            if (n < 1) throw new Error('Нужен многочлен хотя бы первой степени');
            var a = c.map(function (v) { return v / c[0]; });
            // Метод Дюрана — Кернера
            var z = [], seed = math.complex(0.4, 0.9);
            for (var i = 0; i < n; i++) z.push(math.pow(seed, i));
            function p(x) { var r = math.complex(1, 0); for (var k = 1; k <= n; k++) r = math.add(math.multiply(r, x), a[k]); return r; }
            for (var it = 0; it < 500; it++) {
                var maxd = 0;
                for (i = 0; i < n; i++) {
                    var den = math.complex(1, 0);
                    for (var j = 0; j < n; j++) if (j !== i) den = math.multiply(den, math.subtract(z[i], z[j]));
                    var d = math.divide(p(z[i]), den);
                    z[i] = math.subtract(z[i], d);
                    maxd = Math.max(maxd, math.abs(d));
                }
                if (maxd < 1e-15) break;
            }
            var out = z.map(function (v) {
                var re = Math.abs(v.re) < 1e-12 ? 0 : v.re, im = Math.abs(v.im) < 1e-9 ? 0 : v.im;
                return im === 0 ? re : math.complex(re, im);
            });
            out.sort(function (x, y) {
                var xr = typeof x === 'number' ? x : x.re, yr = typeof y === 'number' ? y : y.re;
                return yr - xr;
            });
            return out;
        }

        function erfc(x) { return 1 - math.erf(x); }
        function normpdf(x, mu, s) { mu = mu === undefined ? 0 : mu; s = s === undefined ? 1 : s; return Math.exp(-0.5 * Math.pow((x - mu) / s, 2)) / (s * Math.sqrt(2 * Math.PI)); }
        function phi(x, mu, s) { return 0.5 * erfc(-(x - mu) / (s * Math.SQRT2)); }
        function normcd(a, b, mu, s) { mu = mu === undefined ? 0 : mu; s = s === undefined ? 1 : s; return phi(b, mu, s) - phi(a, mu, s); }
        function invnorm(p, mu, s) {
            mu = mu === undefined ? 0 : mu; s = s === undefined ? 1 : s;
            if (p <= 0 || p >= 1) throw new Error('Вероятность должна быть между 0 и 1');
            var lo = -40, hi = 40;
            for (var i = 0; i < 200; i++) { var m = (lo + hi) / 2; if (phi(m, 0, 1) < p) lo = m; else hi = m; }
            return mu + s * (lo + hi) / 2;
        }
        function binompdf(x, n, p) { if (x < 0 || x > n) return 0; return math.combinations(n, x) * Math.pow(p, x) * Math.pow(1 - p, n - x); }
        function binomcd(x, n, p) { var r = 0; for (var k = 0; k <= Math.min(x, n); k++) r += binompdf(k, n, p); return r; }
        function poissonpdf(x, l) { return Math.exp(-l) * Math.pow(l, x) / math.factorial(x); }
        function poissoncd(x, l) { var r = 0; for (var k = 0; k <= x; k++) r += poissonpdf(k, l); return r; }

        // Pol и Rec: угол в градусах, как в режиме Deg на калькуляторе
        function pol(x, y) { return [Math.hypot(x, y), Math.atan2(y, x) * 180 / Math.PI]; }
        function rec(r, t) { var a = (t && t.isUnit) ? t.toNumber('rad') : t * Math.PI / 180; return [r * Math.cos(a), r * Math.sin(a)]; }

        math.import({
            integral: integral,
            ddx: ddx,
            sigma: series('sum'),
            'Σ': series('sum'),
            'Π': series('prod'),
            solve: solve,
            roots: roots,
            normpdf: normpdf,
            normcd: normcd,
            invnorm: invnorm,
            binompdf: binompdf,
            binomcd: binomcd,
            poissonpdf: poissonpdf,
            poissoncd: poissoncd,
            pol: pol,
            rec: rec
        }, { override: true });

        return math;
    }

    // Имена для подсказок: свои функции и самые ходовые из math.js
    var FUNCTIONS = [
        'integral', 'ddx', 'Σ', 'Π', 'solve', 'roots', 'normpdf', 'normcd', 'invnorm',
        'binompdf', 'binomcd', 'poissonpdf', 'poissoncd', 'pol', 'rec',
        'sqrt', 'cbrt', 'nthRoot', 'abs', 'round', 'floor', 'ceil', 'fix', 'mod', 'gcd', 'lcm',
        'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
        'log', 'log10', 'log2', 'exp', 'factorial', 'combinations', 'permutations',
        'fraction', 'hex', 'bin', 'oct', 'det', 'inv', 'transpose', 'dot', 'cross', 'lusolve',
        'mean', 'median', 'std', 'variance', 'sum', 'prod', 'min', 'max', 'random', 'derivative', 'simplify'
    ];

    root.CalqueMath = { setup: setup, FUNCTIONS: FUNCTIONS };
})(typeof window !== 'undefined' ? window : globalThis);
