import React, {
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
} from "react";
import Editor from "@monaco-editor/react";
import { v4 as uuidv4 } from "uuid";

import { Console } from "console-feed";
import SplitPane from "react-split-pane";
import Pane from "react-split-pane/lib/Pane";
import { ContextMenuTrigger, ContextMenu, MenuItem } from "react-contextmenu";

import { Sidebar } from "./components/Sidebar";

/*
TODO:
- fix console logs
- fix pane dragging
- fix code injection with data url
- setup code saving with firebase

** import maps for supporting scripts modules
-> fetch all module scripts that have a src attribute
-> get the contents of that file, generate data url
-> construct importmap
-> inject importmap 
-> remove all previous script tags

*/

const injectLoggingControl = (doc) => {
  const script = `
    const fakeConsole = {};
    function formatArgs(args) {
      return args
        .map((arg) => {
          if (arg instanceof Element) {
            return arg.outerHTML;
          }
          return typeof arg === 'object' 
            ? JSON.stringify(arg, null, 2)
            : '"' + String(arg) + '"';
        })
        .join(' ')
    }

    for (const level of ['log', 'error', 'warn']) {
      fakeConsole[level] = console[level];
      console[level] = (...args) => {
        fakeConsole[level](...args);
        window.parent.postMessage({ event: 'LOG', level, args: args }, '*');
      }
    }

    window.onerror = function (e, ...args) {
      window.parent.postMessage({ event: 'ERROR', level: 'error', args: args }, '*');
    };
  `;

  var logScript = doc.createElement("script");
  logScript.innerHTML = script;
  doc.head.appendChild(logScript);
  return doc;
};

/**
 * Build an importmap, injecting all the dependencies as data URL's
 * @param {*} html 
 * @param {*} files 
 * @returns 
 * 
<script type="importmap">
{
  "imports": {
    "moment": "/node_modules/moment/src/moment.js",
    "lodash": "/node_modules/lodash-es/lodash.js"
  }
}
</script>
 */
const injectDependenciesImportMap = (html, files) => {
  var parser = new DOMParser();
  var doc = parser.parseFromString(html, "text/html");
  var head = doc.getElementsByTagName("head")[0];
  doc = injectLoggingControl(doc);

  let importsJson = { imports: {} };
  let blobNames = {};
  for (let file of Object.keys(files)) {
    const bb = new Blob([files[file]], { type: getFileMimeType(file) });
    const dataUrl = URL.createObjectURL(bb);
    importsJson.imports[file] = dataUrl;
    importsJson.imports[`~/${file}`] = dataUrl;
    blobNames[`${dataUrl}`] = file;
  }

  const importMap = doc.createElement("script");
  importMap.type = "importmap";
  importMap.innerHTML = JSON.stringify(importsJson, null, 4);
  head.appendChild(importMap);

  return {
    page: doc.documentElement.outerHTML,
    urls: blobNames,
  };
};

const injectDependencies = (html, files) => {
  var parser = new DOMParser();
  var doc = parser.parseFromString(html, "text/html");
  doc = injectLoggingControl(doc);
  var scripts = doc.getElementsByTagName("script");
  for (let i = 0; i < scripts.length; i++) {
    const srcPath = scripts[i].src.split("/");
    if (srcPath.length > 1) {
      const src = srcPath[srcPath.length - 1];
      let newScript = document.createElement("script");
      newScript.innerHTML = files[src];
      scripts[i].replaceWith(newScript);
    }
  }

  return doc.documentElement.outerHTML;
};

const defaultCached = {
  "urn:default": {
    name: "index.html",
    value:
      "<html>\n" +
      "\t<body>\n\t\n\t" +
      "</" +
      "body>\n\n" +
      "\t<script>\n\t// write some code here" +
      "\n\t</" +
      "script>\n" +
      "</html>",
  },
};

const Tab = (props) => {
  const color = props.active
    ? "text-white border-b-2"
    : "hover:bg-gray-500 italic text-green-300";
  return (
    <>
      <ContextMenuTrigger id={`file_${props.children}`}>
        <button
          draggable={true}
          onClick={() => props.onToggle(props.value)}
          className={`text-xs font-semibold ${color} px-4 block focus:outline-none border-white divide-x divide-light-blue-400 h-full`}
        >
          {props.children}
        </button>
      </ContextMenuTrigger>
      <ContextMenu
        hideOnLeave={true}
        id={`file_${props.children}`}
        className="bg-gray-800 text-gray-200 cursor-pointer py-2 w-40 shadow-md text-sm z-50 border-2 border-gray-600"
      >
        <MenuItem
          className="px-5 py-1 hover:bg-gray-500"
          onClick={() => props.onAction("delete", props.value)}
        >
          Delete
        </MenuItem>
        <MenuItem
          className="px-5 py-1 hover:bg-gray-500"
          onClick={() => props.onAction("rename", props.value)}
        >
          Rename
        </MenuItem>
      </ContextMenu>
    </>
  );
};

const NewFileTab = ({ onNewFile }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef();

  const updateValue = (e) => {
    setValue(e.target.value);
  };

  const onKeyPress = (e) => {
    if (e.code === "Enter") inputRef.current.blur();
    if (e.code === "Escape") {
      setEditing(false);
      setValue("");
    }
  };

  const finishEdit = () => {
    if (value) {
      onNewFile(value);
      setEditing(false);
    }
  };

  const startEditing = () => {
    setEditing(true);
    setValue("");
  };

  return (
    <button
      onClick={startEditing}
      className={`text-xs font-semibold px-1 block bg-gray-700 ${
        !editing && "hover:bg-gray-500"
      } focus:outline-none border-t border-l border-r border-gray-600`}
    >
      {editing ? (
        <div className="flex flex-row justify-center text-gray-300">
          <input
            className="bg-transparent text-sm px-1 mx-1 focus:outline-none"
            ref={inputRef}
            autoFocus
            spellCheck={false}
            placeholder="Untitled"
            onChange={updateValue}
            onAbort={() => console.log("Abort")}
            onKeyUp={onKeyPress}
            onBlur={finishEdit}
          />
        </div>
      ) : (
        <div className="flex flex-row justify-center text-gray-300 px-3 italic">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
              clip-rule="evenodd"
            />
          </svg>
          <span>New</span>
        </div>
      )}
    </button>
  );
};

const getFileMimeType = (filename) => {
  const parts = filename.split(".");
  const ext = parts[parts.length - 1];
  if (ext.includes("js")) return "text/javascript";
  if (ext.includes("css")) return "text/css";
  if (ext.includes("html")) return "text/html";
};

const getFileLanguage = (filename) => {
  const parts = filename.split(".");
  const ext = parts[parts.length - 1];
  if (ext.includes("js")) return "javascript";
  if (ext.includes("css")) return "css";
  if (ext.includes("html")) return "html";
};

function App() {
  const iframeRef = useRef();
  const editorRef = useRef();
  const monacoRef = useRef();
  // const monaco = useMonaco()
  const [logs, setLogs] = useState([]);
  const [files, setFiles] = useState({});
  const [iframeCode, setIframeCode] = useState();
  const [savedFiles, setSavedFiles] = useState({});
  const [resizing, setResizing] = useState(false);

  const [isEditorReady, setIsEditorReady] = useState(false);
  const [currentModel, setCurrentModel] = useState();

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    const cachedFiles =
      JSON.parse(localStorage.getItem("jsplay-cache")) || defaultCached;
    let filesObj = {};
    let startFile = null;
    Object.keys(cachedFiles).forEach((fileKey) => {
      monacoRef.current.editor.createModel(
        cachedFiles[fileKey].value,
        getFileLanguage(cachedFiles[fileKey].name),
        fileKey
      );
      filesObj[fileKey] = cachedFiles[fileKey];
      if (startFile == null) {
        startFile = fileKey;
      }
    });

    setFiles(filesObj);

    monacoRef.current.languages.typescript.javascriptDefaults.setEagerModelSync(
      true
    );
    // monacoRef.current.languages.typescript.javascriptDefaults.setCompilerOptions(
    //   {
    //     noLib: true,
    //     allowNonTsExtensions: true,
    //   }
    // );

    setIsEditorReady(true);
    setCurrentModel(startFile);
  };

  useLayoutEffect(() => {
    const onMessage = (e) => {
      if (e.data.event === "LOG") {
        setLogs((l) => [{ method: e.data.level, data: e.data.args }, ...l]);
      }

      if (e.data.event === "ERROR") {
        setLogs((l) => [{ method: "script_err", data: e.data.args }, ...l]);
      }
    };
    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    if (isEditorReady) {
      editorRef.current.setModel(
        monacoRef.current.editor.getModel(currentModel)
      );
    }
  }, [isEditorReady, currentModel]);

  const onNewFile = (filename) => {
    const urn = `urn:${uuidv4()}`;
    const m = monacoRef.current.editor.createModel(
      "// this is a dummy file",
      getFileLanguage(filename),
      urn
    );

    editorRef.current.setModel(m);
    setFiles((f) => {
      let clone = { ...f };
      clone[urn] = {
        value: "// this is a dummy file",
        name: filename,
      };
      return clone;
    });
    setCurrentModel(urn);
  };

  const onChange = (value, event) => {
    let clone = { ...files };
    clone[currentModel].value = value;
    localStorage.setItem("jsplay-cache", JSON.stringify(clone));
  };

  const onTabAction = (action, id) => {
    if (action === "delete") {
      monacoRef.current.editor.getModels().forEach((m) => {
        if (m.uri === id) {
          m.dispose();
        }
      });
      let cloned = { ...files };
      delete cloned[id];
      setFiles(cloned);
    }
  };

  const cleanedLogs = useMemo(() => {
    return logs.map((l) => {
      if (l.method === "script_err") {
        return {
          method: "error",
          data: [`(Line ${l.data[1]} ${savedFiles[l.data[0]]}) ${l.data[3]}`],
        };
      } else {
        return l;
      }
    });
  }, [logs, savedFiles]);

  const onRender = () => {
    const value = monacoRef.current.editor.getModel(currentModel).getValue();
    let valuesMap = {};
    monacoRef.current.editor.getModels().forEach((m) => {
      if (files[m.uri] != null) {
        valuesMap[files[m.uri].name] = m.getValue();
      }
    });
    setLogs([]);
    const { page, urls } = injectDependenciesImportMap(value, valuesMap);
    setIframeCode(page);
    setSavedFiles(urls);
    // setIframeCode(injectDependencies(value, valuesMap));
  };

  const setCurrentTab = (f) => {
    // monacoRef.current.editor.getModels().forEach((m) => {
    //   if (m.language === "javascript") {
    //     monacoRef.current.languages.typescript.javascriptDefaults.addExtraLib(
    //       m.getValue(),
    //       m.uri
    //     );
    //   }
    // });

    setCurrentModel(f);
  };

  const onExport = () => {
    let allScripts;
    try {
      allScripts = JSON.parse(localStorage.getItem("jsplay-cache") || "{}");
    } catch (err) {
      allScripts = {};
    }

    const exported = {
      files: allScripts,
      playmap: {
        version: 1,
      },
    };
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([JSON.stringify(exported)], { type: "text/plain" })
    );
    link.download = "proj.playmap";
    link.click();
  };

  const onImport = () => {
    const upload = document.createElement("input");
    upload.type = "file";
    upload.click();
    upload.onchange = (e) => {
      var reader = new FileReader();
      reader.readAsText(upload.files[0], "utf-8");
      reader.onload = (e) => {
        try {
          const ff = JSON.parse(e.target.result);
          if (ff.playmap && ff.playmap.version) {
            localStorage.setItem("jsplay-cache", JSON.stringify(ff.files));
            window.location.reload();
          } else {
            alert("Invalid playmap file");
          }
        } catch (err) {
          alert("Invalid playmap file");
        }
      };
    };
  };

  return (
    <div className="h-screen w-screen flex">
      <Sidebar
        actions={{
          onRun: onRender,
          onExport: onExport,
          onImport: onImport,
        }}
      />
      <div className="flex flex-col w-full h-full">
        {/* <div className="p-1 max-h-8 h-8 bg-gray-800 border-b-2 border-gray-600 text-sm flex-grow flex justify-between">
          <span></span>
          <span className="text-gray-300 font-semibold">Loading</span>
        </div> */}
        <div class="flex-grow flex flex-row border-gray-600 border-l-2 max-h-screen">
          <SplitPane
            split="vertical"
            onResizeStart={() => setResizing(true)}
            onResizeEnd={(e) => {
              console.log(e);
              setResizing(false);
            }}
          >
            <SplitPane split="horizontal" className="max-h-full">
              <Pane initialSize="90%">
                <div className="flex flex-col h-full">
                  <nav
                    style={{ minHeight: "2.5rem" }}
                    className="flex flex-col w-full overflow-x-scroll sm:flex-row h-10 px-4 pt-1 bg-gray-800"
                  >
                    {Object.keys(files).map((f) => (
                      <Tab
                        key={f}
                        onAction={onTabAction}
                        onToggle={setCurrentTab}
                        value={f}
                        active={currentModel === f}
                      >
                        {files[f].name}
                      </Tab>
                    ))}
                    <NewFileTab onNewFile={onNewFile} />
                  </nav>
                  <Editor
                    theme="vs-dark"
                    className="flex-grow w-full"
                    language="html"
                    ref={editorRef}
                    defaultValue={""}
                    onMount={handleEditorDidMount}
                    onChange={onChange}
                  />
                </div>
              </Pane>
              <Pane initialSize="10%" minSize="10%" maxSize="40%">
                <div class="px-3 overflow-scroll h-full bg-gray-800 border-t-2 border-gray-600 font-mono">
                  <Console logs={cleanedLogs} variant="dark" />
                </div>
              </Pane>
            </SplitPane>
            <Pane initialSize="50%" maxSize="60%" minSize="30%">
              <iframe
                className={`w-full h-full border-gray-600 ${
                  resizing ? "pointer-events-none" : ""
                }`}
                title="Code Preview"
                srcDoc={iframeCode}
                referrerPolicy="origin"
                width="100%"
                ref={iframeRef}
                allowFullScreen
                allow="midi; geolocation; microphone; camera; display-capture; encrypted-media;"
                sandbox="allow-modals allow-forms allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation allow-downloads"
              />
            </Pane>
          </SplitPane>
        </div>
      </div>
    </div>
  );
}

export default App;
