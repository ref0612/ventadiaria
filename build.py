#!/usr/bin/env python3
"""
build.py — empaqueta el proyecto modular (index.html + css/ + js/) en un único
archivo recaudacion.html, autocontenido, para compartir como Artifact o abrir
sin depender de la estructura de carpetas.

El código fuente que se debe editar sigue siendo index.html / css/app.css /
js/*.js — este script solo genera la versión "de un archivo" a partir de esos.

Uso:
    python build.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / 'recaudacion.html'

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def main():
    html = read('index.html')

    # inline css/app.css
    css = read('css/app.css')
    html = html.replace(
        '<link rel="stylesheet" href="css/app.css">',
        f'<style>\n{css}\n</style>'
    )

    # inline cada <script src="js/...."></script> local (los de cdnjs se dejan igual)
    def inline_script(m):
        src = m.group(1)
        if src.startswith('js/'):
            js = read(src)
            return f'<script>\n{js}\n</script>'
        return m.group(0)

    html = re.sub(r'<script src="([^"]+)"></script>', inline_script, html)

    OUT.write_text(html, encoding='utf-8')
    print(f'OK -> {OUT}  ({len(html):,} bytes)')

if __name__ == '__main__':
    main()
