import { useRef, useEffect, useState } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, acceptCompletion } from '@codemirror/autocomplete';
import { basicSetup } from 'codemirror';

type Layout = 'tabs' | 'split';

interface CodeEditorProps {
  initialCss: string;
  htmlContent: string;
  onChange: (css: string) => void;
}

export default function CodeEditor({ initialCss, htmlContent, onChange }: CodeEditorProps) {
  const cssEditorRef = useRef<HTMLDivElement>(null);
  const htmlEditorRef = useRef<HTMLDivElement>(null);
  const cssViewRef = useRef<EditorView | null>(null);
  const htmlViewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [activeTab, setActiveTab] = useState<'css' | 'html'>('css');
  const [layout, setLayout] = useState<Layout>('tabs');

  useEffect(() => {
    if (!cssEditorRef.current) return;

    const state = EditorState.create({
      doc: initialCss,
      extensions: [
        basicSetup,
        css(),
        oneDark,
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
        keymap.of([indentWithTab, ...defaultKeymap]),
        Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
        autocompletion(),
        EditorState.tabSize.of(2),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: cssEditorRef.current });
    cssViewRef.current = view;

    return () => view.destroy();
  }, [initialCss]);

  useEffect(() => {
    if (!htmlEditorRef.current) return;

    const state = EditorState.create({
      doc: htmlContent,
      extensions: [
        basicSetup,
        html(),
        oneDark,
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
        EditorState.readOnly.of(true),
      ],
    });

    const view = new EditorView({ state, parent: htmlEditorRef.current });
    htmlViewRef.current = view;

    return () => view.destroy();
  }, [htmlContent]);

  // Re-measure CodeMirror editors when visibility changes
  useEffect(() => {
    cssViewRef.current?.requestMeasure();
    htmlViewRef.current?.requestMeasure();
  }, [layout, activeTab]);

  const isSplit = layout === 'split';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center border-b border-gray-700">
        {!isSplit && (
          <>
            <button
              className={`px-4 py-2 text-sm font-medium ${activeTab === 'css' ? 'bg-gray-800 text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}`}
              onClick={() => setActiveTab('css')}
            >
              CSS
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium ${activeTab === 'html' ? 'bg-gray-800 text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}`}
              onClick={() => setActiveTab('html')}
            >
              HTML (read-only)
            </button>
          </>
        )}
        {isSplit && (
          <>
            <span className="px-4 py-2 text-sm font-medium bg-gray-800 text-white border-b-2 border-blue-500">CSS</span>
            <span className="px-4 py-2 text-sm font-medium text-gray-400">HTML (read-only)</span>
          </>
        )}
        <div className="ml-auto pr-2">
          <button
            onClick={() => setLayout(isSplit ? 'tabs' : 'split')}
            className="p-1.5 text-gray-400 hover:text-white transition rounded hover:bg-gray-700"
            title={isSplit ? 'Tab view' : 'Split view'}
            aria-label={isSplit ? 'Switch to tab view' : 'Switch to split view'}
          >
            {isSplit ? (
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="2" width="14" height="12" rx="1" />
                <line x1="1" y1="5" x2="15" y2="5" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="2" width="14" height="12" rx="1" />
                <line x1="8" y1="2" x2="8" y2="14" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <div className={`flex-1 overflow-hidden ${isSplit ? 'flex' : ''}`}>
        <div
          ref={cssEditorRef}
          className={`h-full ${isSplit ? 'w-1/2 border-r border-gray-700' : (activeTab === 'css' ? '' : 'hidden')}`}
        />
        <div
          ref={htmlEditorRef}
          className={`h-full ${isSplit ? 'w-1/2' : (activeTab === 'html' ? '' : 'hidden')}`}
        />
      </div>
    </div>
  );
}
