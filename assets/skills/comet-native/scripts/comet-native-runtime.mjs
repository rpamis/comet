#!/usr/bin/env node
import { createRequire as __cometCreateRequire } from 'module';
const require = __cometCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path29) {
      const ctrl = callVisitor(key, node, visitor, path29);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path29, ctrl);
        return visit_(key, ctrl, visitor, path29);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path29 = Object.freeze(path29.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path29);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path29 = Object.freeze(path29.concat(node));
          const ck = visit_("key", node.key, visitor, path29);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path29);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path29) {
      const ctrl = await callVisitor(key, node, visitor, path29);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path29, ctrl);
        return visitAsync_(key, ctrl, visitor, path29);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path29 = Object.freeze(path29.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path29);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path29 = Object.freeze(path29.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path29);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path29);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path29) {
      if (typeof visitor === "function")
        return visitor(key, node, path29);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path29);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path29);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path29);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path29);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path29);
      return void 0;
    }
    function replaceNode(key, path29, node) {
      const parent = path29[path29.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const { anchors: anchors2, doc, maxAliasCount } = ctx;
        const source = this.resolve(doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (!data) {
          toJS.toJS(source, null, ctx);
          data = anchors2.get(source);
        }
        if (data?.res === void 0) {
          const msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0) {
          data.count += 1;
          if (data.aliasCount === 0)
            data.aliasCount = getAliasCount(doc, source, anchors2);
          if (data.count * data.aliasCount > maxAliasCount) {
            const msg = "Excessive alias count indicates a resource exhaustion attack";
            throw new ReferenceError(msg);
          }
        }
        return data.res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path29, value) {
      let v = value;
      for (let i = path29.length - 1; i >= 0; --i) {
        const k = path29[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path29) => path29 == null || typeof path29 === "object" && !!path29[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path29, value) {
        if (isEmptyPath(path29))
          this.add(value);
        else {
          const [key, ...rest] = path29;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path29) {
        const [key, ...rest] = path29;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path29, keepScalar) {
        const [key, ...rest] = path29;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path29) {
        const [key, ...rest] = path29;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path29, value) {
        const [key, ...rest] = path29;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify4(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify4;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify4 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify4.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify4.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify4 = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify4.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify4 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify5 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify5(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify4.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify4.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify4 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify4.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify4.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify4.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path29, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path29, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path29) {
        if (Collection.isEmptyPath(path29)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path29) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path29, keepScalar) {
        if (Collection.isEmptyPath(path29))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path29, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path29) {
        if (Collection.isEmptyPath(path29))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path29) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path29, value) {
        if (Collection.isEmptyPath(path29)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path29), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path29, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "…" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "…";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "…\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return foldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return foldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function foldLines(source) {
      let first, line;
      try {
        first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
        line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
      } catch {
        first = /(.*?)[ \t]*\r?\n/sy;
        line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
      }
      let match = first.exec(source);
      if (!match)
        return source;
      let res = match[1];
      let sep = " ";
      let pos = first.lastIndex;
      line.lastIndex = pos;
      while (match = line.exec(source)) {
        if (match[1] === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + match[1];
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "",
      // Unicode next line
      _: " ",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify4 = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify4;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path29) => {
      let item = cst;
      for (const [field2, index] of path29) {
        const tok = item?.[field2];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path29) => {
      const parent = visit.itemAtPath(cst, path29.slice(0, -1));
      const field2 = path29[path29.length - 1][0];
      const coll = parent?.[field2];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path29, item, visitor) {
      let ctrl = visitor(item, path29);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field2 of ["key", "value"]) {
        const token = item[field2];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path29.concat([[field2, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field2 === "key")
            ctrl = ctrl(item, path29);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path29) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs25 = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs25, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs25);
              } else {
                Object.assign(it, { key: fs25, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs25 = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs25, sep: [] });
              else if (it.sep)
                this.stack.push(fs25);
              else
                Object.assign(it, { key: fs25, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument3(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument3(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify4(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument3;
    exports.stringify = stringify4;
  }
});

// node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// domains/comet-native/native-cli-entry.ts
import { pathToFileURL } from "url";

// domains/comet-native/native-cli.ts
import { promises as fs24 } from "fs";
import path28 from "path";

// domains/comet-native/native-archive.ts
import { randomUUID as randomUUID7 } from "crypto";
import { promises as fs17 } from "fs";
import path19 from "path";

// domains/engine/loop.ts
import { createHash } from "crypto";

// domains/engine/guardrails.ts
function checkAction(action, state, guardrails, confirmations) {
  if (state.iteration >= guardrails.maxIterations) {
    return { allowed: false, reason: `Iteration budget exhausted: ${guardrails.maxIterations}` };
  }
  if (action.type === "invoke_skill" && !guardrails.allowedSkills.includes(action.ref ?? "")) {
    return { allowed: false, reason: `Skill is not allowed: ${action.ref ?? "(missing)"}` };
  }
  if (action.type === "call_tool" && !guardrails.allowedTools.includes(action.ref ?? "")) {
    return { allowed: false, reason: `Tool is not allowed: ${action.ref ?? "(missing)"}` };
  }
  if (action.type === "handoff" && !guardrails.allowedAgents.includes(action.ref ?? "")) {
    return { allowed: false, reason: `Agent is not allowed: ${action.ref ?? "(missing)"}` };
  }
  if (action.ref && guardrails.confirmationRequiredFor.includes(action.ref) && !confirmations.has(action.ref)) {
    return { allowed: false, reason: `User confirmation required for: ${action.ref}` };
  }
  const retries2 = state.retries[action.id] ?? 0;
  if (retries2 > guardrails.maxRetriesPerAction) {
    return { allowed: false, reason: `Retry budget exhausted for action: ${action.id}` };
  }
  return { allowed: true };
}

// domains/engine/resolver.ts
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
}
function readonlyCopy(value) {
  return deepFreeze(structuredClone(value));
}
function resolveDeterministicStep(resolver, pkg, state, context) {
  return resolver.resolveStep({
    pkg: readonlyCopy(pkg),
    state: readonlyCopy(state),
    context: readonlyCopy(context)
  });
}
function resolveDeterministicNext(resolver, pkg, state, step, outcome, context) {
  return resolver.resolveNext({
    pkg: readonlyCopy(pkg),
    state: readonlyCopy(state),
    step: readonlyCopy(step),
    outcome: readonlyCopy(outcome),
    context: readonlyCopy(context)
  });
}

// domains/engine/loop.ts
function actionId(runId, iteration, stepId) {
  return createHash("sha256").update(`${runId}:${iteration}:${stepId ?? "adaptive"}`).digest("hex").slice(0, 16);
}
function stepFor(pkg, id) {
  return pkg.definition.orchestration.steps?.find((step) => step.id === id);
}
function decideWithResolver(pkg, state, confirmations, resolver, context) {
  if (state.status !== "running") return { state, action: null, reason: `Run is ${state.status}` };
  if (state.pending)
    return { state, action: null, reason: `Action already pending: ${state.pending}` };
  if (state.orchestration === "adaptive") {
    return { state, action: null, reason: "Adaptive orchestration requires an Agent candidate" };
  }
  const resolvedStep = resolveDeterministicStep(resolver, pkg, state, context);
  if (!resolvedStep && state.currentStep === null) {
    return { state: { ...state, status: "completed" }, action: null };
  }
  if (!resolvedStep) {
    return {
      state: { ...state, status: "failed" },
      action: null,
      reason: `Unknown current step: ${state.currentStep}`
    };
  }
  const step = stepFor(pkg, resolvedStep.id);
  if (!step) {
    return {
      state: { ...state, status: "failed" },
      action: null,
      reason: `Resolver returned unknown current step: ${resolvedStep.id}`
    };
  }
  const resolvedState = state.currentStep === step.id ? state : { ...state, currentStep: step.id };
  const action = {
    ...step.action,
    id: actionId(resolvedState.runId, resolvedState.iteration, step.id),
    stepId: step.id
  };
  return acceptAction(pkg, resolvedState, action, confirmations);
}
function acceptAction(pkg, state, action, confirmations) {
  const guard = checkAction(action, state, pkg.guardrails, confirmations);
  if (!guard.allowed) return { state, action: null, reason: guard.reason };
  return { state: { ...state, pending: action.id, status: "waiting" }, action };
}
function recordOutcomeWithResolver(pkg, state, outcome, resolver, context) {
  if (!state.pending || state.pending !== outcome.actionId) {
    throw new Error(`Outcome does not match pending action: ${outcome.actionId}`);
  }
  const resolvedStep = state.orchestration === "deterministic" ? resolveDeterministicStep(resolver, pkg, state, context) : void 0;
  const step = resolvedStep ? stepFor(pkg, resolvedStep.id) : void 0;
  if (state.orchestration === "deterministic" && !resolvedStep) {
    throw new Error(`Unknown current step: ${state.currentStep ?? "(missing)"}`);
  }
  if (state.orchestration === "deterministic" && !step) {
    throw new Error(`Resolver returned unknown current step: ${resolvedStep.id}`);
  }
  if (outcome.status === "failed") {
    const retries2 = {
      ...state.retries,
      [outcome.actionId]: (state.retries[outcome.actionId] ?? 0) + 1
    };
    return { ...state, pending: null, status: "running", retries: retries2 };
  }
  const next = state.orchestration === "deterministic" ? resolveDeterministicNext(resolver, pkg, state, step, outcome, context) : state.currentStep;
  if (next !== null && state.orchestration === "deterministic" && !stepFor(pkg, next)) {
    throw new Error(`Resolver returned unknown next step: ${next}`);
  }
  return {
    ...state,
    currentStep: next,
    iteration: state.iteration + 1,
    pending: null,
    status: next === null && state.orchestration === "deterministic" ? "completed" : "running"
  };
}

// domains/engine/run-store.ts
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
function resolveRunPath(changeDir, relativePath) {
  if (path.isAbsolute(relativePath))
    throw new Error("Run path must stay inside the change directory");
  const root = path.resolve(changeDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Run path must stay inside the change directory");
  }
  return target;
}
async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, file);
}
async function readOptionalText(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function appendTrajectory(changeDir, relativePath, event) {
  const file = resolveRunPath(changeDir, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(event) + "\n", "utf8");
}
async function readTrajectory(changeDir, relativePath) {
  const raw = await readOptionalText(resolveRunPath(changeDir, relativePath));
  if (raw === null) return [];
  return raw.split(/\r?\n/).map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => line.length > 0).map(({ line, number }) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid Trajectory event at line ${number}`, { cause: error });
    }
  });
}
async function writeCheckpoint(changeDir, relativePath, checkpoint) {
  await atomicWrite(
    resolveRunPath(changeDir, relativePath),
    JSON.stringify(checkpoint, null, 2) + "\n"
  );
}
async function readCheckpoint(changeDir, relativePath) {
  const raw = await readOptionalText(resolveRunPath(changeDir, relativePath));
  return raw === null ? null : JSON.parse(raw);
}

// domains/engine/storage-layout.ts
import path2 from "path";
var NATIVE_RUN_STORAGE = /* @__PURE__ */ Object.freeze({
  stateRef: "runtime/run-state.json",
  pendingRef: "runtime/pending-action.json",
  trajectoryRef: "runtime/trajectory.jsonl",
  contextRef: "runtime/context.md",
  artifactsRef: "runtime/artifacts.json",
  checkpointRef: "runtime/checkpoints/latest.json",
  snapshotsRef: "runtime/skill-snapshots"
});
function assertRunStorageRef(value) {
  if (value.length === 0 || path2.isAbsolute(value) || /^(?:[A-Za-z]:|[\\/]|~)/u.test(value) || value.split(/[\\/]/u).includes("..")) {
    throw new Error("Run storage ref must stay inside the Run root");
  }
}
function assertRunStorageLayout(storage) {
  for (const value of Object.values(storage)) assertRunStorageRef(value);
}

// domains/engine/storage-run.ts
import { randomUUID as randomUUID2 } from "crypto";
import { promises as fs2 } from "fs";
import path4 from "path";

// domains/engine/state.ts
import path3 from "path";
var field = (doc, key) => {
  const value = doc[key];
  return value === null || value === void 0 ? null : String(value);
};
function requiredString(doc, key) {
  const value = doc[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid Run state: ${key} must be a non-empty string`);
  }
  return value;
}
function requiredRunReference(doc, key) {
  const value = requiredString(doc, key);
  if (path3.isAbsolute(value) || /^(?:[A-Za-z]:|[\\/]|~)/u.test(value) || value.split(/[\\/]/u).includes("..")) {
    throw new Error(`Invalid Run state: ${key} must stay inside the change directory`);
  }
  return value;
}
function retries(doc) {
  const raw = doc.run_retries ?? "{}";
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error("Invalid Run state: run_retries must be a JSON object", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Run state: run_retries must be a JSON object");
  }
  for (const count of Object.values(value)) {
    if (!Number.isInteger(count) || Number(count) < 0) {
      throw new Error("Invalid Run state: retry counts must be non-negative integers");
    }
  }
  return value;
}
function runStateFromDocument(doc) {
  if (!doc.run_id) return null;
  const runId = requiredString(doc, "run_id");
  const skill = requiredString(doc, "skill");
  const skillVersion = requiredString(doc, "skill_version");
  const skillHash = requiredString(doc, "skill_hash");
  const pendingRef = requiredRunReference(doc, "pending_ref");
  const trajectoryRef = requiredRunReference(doc, "trajectory_ref");
  const contextRef = requiredRunReference(doc, "context_ref");
  const artifactsRef = requiredRunReference(doc, "artifacts_ref");
  const checkpointRef = requiredRunReference(doc, "checkpoint_ref");
  const iteration = Number(doc.iteration);
  if (!Number.isInteger(iteration) || iteration < 0) {
    throw new Error("Invalid Run state: iteration must be a non-negative integer");
  }
  if (doc.orchestration !== "deterministic" && doc.orchestration !== "adaptive") {
    throw new Error("Invalid Run state: orchestration must be deterministic or adaptive");
  }
  if (doc.run_status !== "running" && doc.run_status !== "waiting" && doc.run_status !== "completed" && doc.run_status !== "failed") {
    throw new Error("Invalid Run state: run_status is invalid");
  }
  return {
    runId,
    skill,
    skillVersion,
    skillHash,
    orchestration: doc.orchestration,
    currentStep: field(doc, "current_step"),
    iteration,
    pending: field(doc, "pending"),
    pendingRef,
    trajectoryRef,
    contextRef,
    artifactsRef,
    checkpointRef,
    status: doc.run_status,
    retries: retries(doc)
  };
}

// domains/engine/storage-run.ts
function toStoredState(state) {
  return { ...state };
}
function fromStoredState(json) {
  const document = {
    run_id: json.runId,
    skill: json.skill,
    skill_version: json.skillVersion,
    skill_hash: json.skillHash,
    orchestration: json.orchestration,
    current_step: json.currentStep,
    iteration: json.iteration,
    pending: json.pending,
    pending_ref: json.pendingRef,
    trajectory_ref: json.trajectoryRef,
    context_ref: json.contextRef,
    artifacts_ref: json.artifactsRef,
    checkpoint_ref: json.checkpointRef,
    run_status: json.status,
    run_retries: JSON.stringify(json.retries)
  };
  return runStateFromDocument(document);
}
function stateFile(changeDir, storage) {
  assertRunStorageLayout(storage);
  return path4.resolve(changeDir, ...storage.stateRef.split(/[\\/]/u));
}
function startRunWithStorage(pkg, runId, skillHash, storage) {
  assertRunStorageLayout(storage);
  return {
    runId,
    skill: pkg.definition.metadata.name,
    skillVersion: pkg.definition.metadata.version,
    skillHash,
    orchestration: pkg.definition.orchestration.mode,
    currentStep: pkg.definition.orchestration.entry ?? null,
    iteration: 0,
    pending: null,
    pendingRef: storage.pendingRef,
    trajectoryRef: storage.trajectoryRef,
    contextRef: storage.contextRef,
    artifactsRef: storage.artifactsRef,
    checkpointRef: storage.checkpointRef,
    status: "running",
    retries: {}
  };
}
async function readRunStateAt(changeDir, storage) {
  let raw;
  try {
    raw = await fs2.readFile(stateFile(changeDir, storage), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return fromStoredState(JSON.parse(raw));
}
async function writeRunStateAt(changeDir, state, storage) {
  const file = stateFile(changeDir, storage);
  await fs2.mkdir(path4.dirname(file), { recursive: true });
  const temporary = path4.join(path4.dirname(file), `run-state.${randomUUID2()}.tmp`);
  await fs2.writeFile(temporary, JSON.stringify(toStoredState(state), null, 2), "utf8");
  await fs2.rename(temporary, file);
}

// domains/comet-native/native-artifacts.ts
import { promises as fs12 } from "fs";
import path15 from "path";

// domains/comet-native/native-change.ts
var import_yaml2 = __toESM(require_dist(), 1);
import { promises as fs11 } from "fs";
import path14 from "path";

// domains/comet-native/native-atomic-file.ts
import { randomUUID as randomUUID3 } from "crypto";
import { promises as fs3 } from "fs";
import path5 from "path";
function isInside(parent, target) {
  const relative = path5.relative(parent, target);
  return relative === "" || !path5.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path5.sep}`);
}
function sameDirectoryIdentity(identity, stat) {
  if (identity.dev !== 0 || identity.ino !== 0 || stat.dev !== 0 || stat.ino !== 0) {
    return identity.dev === stat.dev && identity.ino === stat.ino;
  }
  return identity.birthtimeMs === stat.birthtimeMs;
}
function sameFileIdentity(left, right) {
  if (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.birthtimeMs === right.birthtimeMs && left.ctimeMs === right.ctimeMs && left.size === right.size;
}
async function captureDirectoryIdentity(directory) {
  const stat = await fs3.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Native atomic write parent must be a real directory: ${directory}`);
  }
  return {
    path: directory,
    realPath: await fs3.realpath(directory),
    dev: stat.dev,
    ino: stat.ino,
    birthtimeMs: stat.birthtimeMs
  };
}
async function verifyDirectoryChain(chain) {
  for (const identity of chain) {
    const stat = await fs3.lstat(identity.path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !sameDirectoryIdentity(identity, stat) || await fs3.realpath(identity.path) !== identity.realPath) {
      throw new Error(`Native atomic write parent changed before commit: ${identity.path}`);
    }
  }
}
async function prepareContainedDirectoryChain(root, directory) {
  const lexicalRoot = path5.resolve(root);
  const lexicalDirectory = path5.resolve(directory);
  if (!isInside(lexicalRoot, lexicalDirectory)) {
    throw new Error(`Native atomic write parent is outside its managed root: ${directory}`);
  }
  const chain = [await captureDirectoryIdentity(lexicalRoot)];
  const segments = path5.relative(lexicalRoot, lexicalDirectory).split(path5.sep).filter(Boolean);
  let cursor = lexicalRoot;
  for (const segment of segments) {
    await verifyDirectoryChain(chain);
    cursor = path5.join(cursor, segment);
    try {
      await fs3.mkdir(cursor);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const identity = await captureDirectoryIdentity(cursor);
    if (!isInside(chain[0].realPath, identity.realPath)) {
      throw new Error(`Native atomic write parent resolves outside its managed root: ${cursor}`);
    }
    chain.push(identity);
  }
  await verifyDirectoryChain(chain);
  return chain;
}
async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs3.open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = error.code;
    if (!["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(code ?? "")) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}
async function atomicWriteText(file, content, options = {}) {
  const directory = path5.dirname(file);
  const directoryChain = options.containedRoot ? await prepareContainedDirectoryChain(options.containedRoot, directory) : null;
  if (!directoryChain) await fs3.mkdir(directory, { recursive: true });
  const temporary = path5.join(directory, `.${path5.basename(file)}.${randomUUID3()}.tmp`);
  let handle;
  let temporaryIdentity;
  try {
    handle = await fs3.open(temporary, "wx");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    temporaryIdentity = await handle.stat();
    await handle.close();
    handle = void 0;
    await options.beforeCommit?.();
    if (directoryChain) {
      await verifyDirectoryChain(directoryChain);
      const temporaryStat = await fs3.lstat(temporary);
      if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink() || !temporaryIdentity || !sameFileIdentity(temporaryStat, temporaryIdentity)) {
        throw new Error("Native atomic write temporary file changed before commit");
      }
    }
    await fs3.rename(temporary, file);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close();
    if (!directoryChain) {
      await fs3.rm(temporary, { force: true });
    } else {
      try {
        await verifyDirectoryChain(directoryChain);
        await fs3.rm(temporary, { force: true });
      } catch {
      }
    }
    throw error;
  }
}
async function atomicWriteJson(file, value, options = {}) {
  await atomicWriteText(file, JSON.stringify(value, null, 2) + "\n", options);
}

// domains/comet-native/native-config.ts
var import_yaml = __toESM(require_dist(), 1);
import { promises as fs5 } from "fs";
import path7 from "path";

// domains/comet-native/native-paths.ts
import { promises as fs4 } from "fs";
import path6 from "path";
var PROJECT_CONFIG_FILE = "comet.config.yaml";
async function isFileOrDirectory(target) {
  try {
    await fs4.lstat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function inside(parent, target) {
  const relative = path6.relative(parent, target);
  return relative === "" || !path6.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path6.sep}`);
}
async function physicalPath(target) {
  const missing = [];
  let cursor = target;
  while (!await isFileOrDirectory(cursor)) {
    const parent = path6.dirname(cursor);
    if (parent === cursor) break;
    missing.push(path6.basename(cursor));
    cursor = parent;
  }
  const existing = await fs4.realpath(cursor);
  return path6.resolve(existing, ...missing.reverse());
}
async function isSymbolicLink(target) {
  try {
    return (await fs4.lstat(target)).isSymbolicLink();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function discoverNativeProject(startPath) {
  let cursor = path6.resolve(startPath);
  try {
    if (!(await fs4.stat(cursor)).isDirectory()) cursor = path6.dirname(cursor);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const fallback = cursor;
  while (true) {
    if (await isFileOrDirectory(path6.join(cursor, PROJECT_CONFIG_FILE))) return cursor;
    if (await isFileOrDirectory(path6.join(cursor, ".git"))) return cursor;
    const parent = path6.dirname(cursor);
    if (parent === cursor) return fallback;
    cursor = parent;
  }
}
function normalizeArtifactRootRef(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0 || path6.isAbsolute(trimmed) || /^(?:[A-Za-z]:|~|[\\/])/u.test(trimmed)) {
    throw new Error("native.artifact_root must be a project-relative path");
  }
  const segments = trimmed.replaceAll("\\", "/").split("/");
  if (segments.includes("..")) {
    throw new Error("native.artifact_root must stay inside the project root");
  }
  const normalized = path6.posix.normalize(segments.filter((segment) => segment !== "").join("/"));
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("native.artifact_root must stay inside the project root");
  }
  return normalized === "" ? "." : normalized;
}
async function resolveArtifactRoot(projectRoot, value) {
  const normalized = normalizeArtifactRootRef(value);
  const lexical = path6.resolve(projectRoot, ...normalized.split("/"));
  const physicalProject = await fs4.realpath(projectRoot);
  const physicalTarget = await physicalPath(lexical);
  if (!inside(physicalProject, physicalTarget)) {
    throw new Error("native.artifact_root resolves outside the project root");
  }
  return lexical;
}
async function nativeProjectPaths(projectRoot, artifactRootRef) {
  const normalized = normalizeArtifactRootRef(artifactRootRef);
  const artifactRoot = await resolveArtifactRoot(projectRoot, normalized);
  const nativeRoot = path6.join(artifactRoot, "comet");
  if (await isSymbolicLink(nativeRoot)) {
    throw new Error("The configured Native comet root must not be a symbolic link");
  }
  const [physicalArtifactRoot, physicalNativeRoot] = await Promise.all([
    physicalPath(artifactRoot),
    physicalPath(nativeRoot)
  ]);
  if (!inside(physicalArtifactRoot, physicalNativeRoot)) {
    throw new Error("The configured Native comet root resolves outside its artifact root");
  }
  return {
    projectRoot: path6.resolve(projectRoot),
    configFile: path6.join(projectRoot, PROJECT_CONFIG_FILE),
    artifactRoot,
    artifactRootRef: normalized,
    nativeRoot,
    specsDir: path6.join(nativeRoot, "specs"),
    changesDir: path6.join(nativeRoot, "changes"),
    archiveDir: path6.join(nativeRoot, "archive"),
    runtimeDir: path6.join(nativeRoot, "runtime"),
    locksDir: path6.join(nativeRoot, "runtime", "locks"),
    transactionsDir: path6.join(nativeRoot, "runtime", "transactions")
  };
}
async function ensureNativeDirectories(paths) {
  const directories = [
    paths.specsDir,
    paths.changesDir,
    paths.archiveDir,
    paths.locksDir,
    paths.transactionsDir
  ];
  await Promise.all(
    directories.map(async (directory) => {
      await resolveContainedNativePath(paths.nativeRoot, directory);
      await fs4.mkdir(directory, { recursive: true });
    })
  );
}
function isInsidePath(parent, target) {
  return inside(path6.resolve(parent), path6.resolve(target));
}
async function resolveContainedNativePath(root, target) {
  const lexicalRoot = path6.resolve(root);
  const lexicalTarget = path6.resolve(target);
  if (!inside(lexicalRoot, lexicalTarget)) {
    throw new Error(`Path is outside the Native root: ${target}`);
  }
  if (await isSymbolicLink(lexicalRoot)) {
    throw new Error(`Native root must not be a symbolic link: ${root}`);
  }
  const [physicalRoot, physicalTarget] = await Promise.all([
    physicalPath(lexicalRoot),
    physicalPath(lexicalTarget)
  ]);
  if (!inside(physicalRoot, physicalTarget)) {
    throw new Error(`Path resolves outside the Native root: ${target}`);
  }
  return lexicalTarget;
}

// domains/comet-native/native-config.ts
var ROOT_KEYS = /* @__PURE__ */ new Set(["schema", "default_workflow", "native"]);
var NATIVE_KEYS = /* @__PURE__ */ new Set(["artifact_root", "pending_root_move"]);
var PENDING_KEYS = /* @__PURE__ */ new Set(["id", "from_artifact_root", "to_artifact_root", "stage"]);
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value;
}
function rejectUnknown(value, known, label) {
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(", ")}`);
}
function parsePending(value) {
  if (value === void 0) return void 0;
  const pending = record(value, "native.pending_root_move");
  rejectUnknown(pending, PENDING_KEYS, "native.pending_root_move");
  const id = pending.id;
  const from = pending.from_artifact_root;
  const to = pending.to_artifact_root;
  const stage = pending.stage;
  if (typeof id !== "string" || !/^[a-f0-9-]{8,}$/u.test(id)) {
    throw new Error("native.pending_root_move.id is invalid");
  }
  if (typeof from !== "string" || typeof to !== "string") {
    throw new Error("native.pending_root_move roots must be strings");
  }
  if (stage !== "copying" && stage !== "ready" && stage !== "switched") {
    throw new Error("native.pending_root_move.stage is invalid");
  }
  return {
    id,
    fromArtifactRoot: normalizeArtifactRootRef(from),
    toArtifactRoot: normalizeArtifactRootRef(to),
    stage
  };
}
function parseConfig(value) {
  const root = record(value, PROJECT_CONFIG_FILE);
  rejectUnknown(root, ROOT_KEYS, PROJECT_CONFIG_FILE);
  if (root.schema !== "comet.project.v1") throw new Error("Unsupported Comet project schema");
  if (root.default_workflow !== "native" && root.default_workflow !== "classic") {
    throw new Error("default_workflow must be native or classic");
  }
  const native = record(root.native, "native");
  rejectUnknown(native, NATIVE_KEYS, "native");
  if (typeof native.artifact_root !== "string") {
    throw new Error("native.artifact_root must be a string");
  }
  const pending = parsePending(native.pending_root_move);
  return {
    schema: "comet.project.v1",
    default_workflow: root.default_workflow,
    native: {
      artifact_root: normalizeArtifactRootRef(native.artifact_root),
      ...pending ? { pending_root_move: pending } : {}
    }
  };
}
function defaultProjectConfig(artifactRoot = ".") {
  return {
    schema: "comet.project.v1",
    default_workflow: "native",
    native: { artifact_root: normalizeArtifactRootRef(artifactRoot) }
  };
}
async function readProjectConfig(projectRoot) {
  const file = path7.join(projectRoot, PROJECT_CONFIG_FILE);
  let source;
  try {
    source = await fs5.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const document = (0, import_yaml.parseDocument)(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid ${PROJECT_CONFIG_FILE}: ${document.errors[0].message}`);
  }
  return parseConfig(document.toJS());
}
async function assertNoPendingNativeRootMove(projectRoot) {
  const config = await readProjectConfig(projectRoot);
  if (config?.native.pending_root_move) {
    throw new Error(
      `Native root move ${config.native.pending_root_move.id} is incomplete; use comet native doctor --repair`
    );
  }
}
async function writeProjectConfig(projectRoot, config) {
  const validated = parseConfig({
    schema: config.schema,
    default_workflow: config.default_workflow,
    native: {
      artifact_root: config.native.artifact_root,
      ...config.native.pending_root_move ? {
        pending_root_move: {
          id: config.native.pending_root_move.id,
          from_artifact_root: config.native.pending_root_move.fromArtifactRoot,
          to_artifact_root: config.native.pending_root_move.toArtifactRoot,
          stage: config.native.pending_root_move.stage
        }
      } : {}
    }
  });
  const document = {
    schema: validated.schema,
    default_workflow: validated.default_workflow,
    native: {
      artifact_root: validated.native.artifact_root,
      ...validated.native.pending_root_move ? {
        pending_root_move: {
          id: validated.native.pending_root_move.id,
          from_artifact_root: validated.native.pending_root_move.fromArtifactRoot,
          to_artifact_root: validated.native.pending_root_move.toArtifactRoot,
          stage: validated.native.pending_root_move.stage
        }
      } : {}
    }
  };
  await atomicWriteText(path7.join(projectRoot, PROJECT_CONFIG_FILE), (0, import_yaml.stringify)(document));
}
async function resolveNativeProject(options) {
  const projectRoot = await discoverNativeProject(options.startPath);
  const existing = await readProjectConfig(projectRoot);
  if (!existing && options.allowMissingConfig === false) {
    throw new Error(`${PROJECT_CONFIG_FILE} was not found`);
  }
  if (existing?.native.pending_root_move) {
    throw new Error(
      `Native root move ${existing.native.pending_root_move.id} is incomplete; use comet native doctor --repair`
    );
  }
  const explicit = options.explicitArtifactRoot ? normalizeArtifactRootRef(options.explicitArtifactRoot) : void 0;
  if (existing && explicit && explicit !== existing.native.artifact_root) {
    throw new Error(
      `Configured Native artifact root is ${existing.native.artifact_root}; refusing conflicting root ${explicit}`
    );
  }
  const config = existing ?? defaultProjectConfig(explicit ?? ".");
  const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
  return { config, paths, configured: existing !== null };
}

// domains/comet-native/native-mutation-lock.ts
import { promises as fs8 } from "fs";
import path10 from "path";

// domains/comet-native/native-lock.ts
import { randomUUID as randomUUID4 } from "crypto";
import { promises as fs6 } from "fs";
import os from "os";
import path8 from "path";
function lockName(value) {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) throw new Error(`Invalid Native lock name: ${value}`);
  return `${value}.lock`;
}
async function readNativeLock(file) {
  try {
    const value = JSON.parse(await fs6.readFile(file, "utf8"));
    if (typeof value.id !== "string" || typeof value.pid !== "number" || typeof value.hostname !== "string" || typeof value.createdAt !== "string" || typeof value.operation !== "string") {
      throw new Error(`Invalid Native lock metadata: ${file}`);
    }
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function acquireNativeLock(paths, name, operation) {
  const locksDir = await resolveContainedNativePath(paths.nativeRoot, paths.locksDir);
  await fs6.mkdir(locksDir, { recursive: true });
  const file = await resolveContainedNativePath(
    paths.nativeRoot,
    path8.join(locksDir, lockName(name))
  );
  const owner = {
    id: randomUUID4(),
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    operation
  };
  let handle;
  try {
    handle = await fs6.open(file, "wx");
  } catch (error) {
    if (error.code === "EEXIST") {
      const existing = await readNativeLock(file);
      throw new Error(
        `Native lock is already held: ${file}${existing ? ` by pid ${existing.pid} for ${existing.operation}` : ""}`,
        { cause: error }
      );
    }
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify(owner, null, 2) + "\n", "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { file, owner };
}
async function releaseNativeLock(lock) {
  const current = await readNativeLock(lock.file);
  if (!current) return;
  if (current.id !== lock.owner.id) throw new Error(`Native lock ownership changed: ${lock.file}`);
  await fs6.rm(lock.file, { force: true });
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error.code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return null;
  }
}
async function diagnoseNativeLock(file) {
  const owner = await readNativeLock(file);
  if (!owner) return { status: "missing", owner: null };
  if (owner.hostname !== os.hostname()) return { status: "unknown", owner };
  const alive = isProcessAlive(owner.pid);
  return { status: alive === true ? "active" : alive === false ? "stale" : "unknown", owner };
}

// domains/comet-native/native-transaction.ts
import { promises as fs7 } from "fs";
import path9 from "path";
var JOURNAL_KEYS = /* @__PURE__ */ new Set([
  "schema",
  "id",
  "kind",
  "status",
  "projectRoot",
  "nativeRoot",
  "change",
  "createdAt",
  "operations"
]);
var OPERATION_KEYS = /* @__PURE__ */ new Set(["id", "type", "source", "target", "staged", "backup"]);
var EVENT_KEYS = /* @__PURE__ */ new Set(["sequence", "timestamp", "type", "operationId"]);
var TRANSACTION_STATUSES = /* @__PURE__ */ new Set([
  "prepared",
  "applying",
  "committed",
  "rolling-back",
  "rolled-back"
]);
var EVENT_TYPES = /* @__PURE__ */ new Set([
  "prepared",
  "operation-started",
  "operation-completed",
  "archive-finalization-started",
  "archive-finalized",
  "commit",
  "rollback-started",
  "rollback-completed"
]);
function record2(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}
function rejectUnknown2(value, keys, label) {
  const unknown = Object.keys(value).filter((key) => !keys.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(", ")}`);
}
function validTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}
function assertRef(ref, label) {
  if (typeof ref !== "string" || ref.length === 0 || path9.isAbsolute(ref) || /^(?:[A-Za-z]:|~|[\\/])/u.test(ref) || ref.split(/[\\/]/u).includes("..")) {
    throw new Error(`${label} must stay inside the Native root`);
  }
}
function parseOperation(value, index) {
  const operation = record2(value, `transaction operations[${index}]`);
  rejectUnknown2(operation, OPERATION_KEYS, `transaction operations[${index}]`);
  if (typeof operation.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(operation.id)) {
    throw new Error(`transaction operations[${index}].id is invalid`);
  }
  if (operation.type !== "write" && operation.type !== "remove" && operation.type !== "move") {
    throw new Error(`transaction operation ${operation.id} has an invalid type`);
  }
  assertRef(operation.target, `transaction operation ${operation.id} target`);
  for (const field2 of ["source", "staged", "backup"]) {
    if (operation[field2] !== void 0) {
      assertRef(operation[field2], `transaction operation ${operation.id} ${field2}`);
    }
  }
  if (operation.type === "write") {
    if (operation.staged === void 0 || operation.source !== void 0) {
      throw new Error(`write operation ${operation.id} requires staged and forbids source`);
    }
  } else if (operation.type === "remove") {
    if (operation.source !== void 0 || operation.staged !== void 0) {
      throw new Error(`remove operation ${operation.id} forbids source and staged`);
    }
  } else if (operation.source === void 0 || operation.staged !== void 0 || operation.backup !== void 0) {
    throw new Error(`move operation ${operation.id} requires source and forbids staged and backup`);
  }
  return operation;
}
function parseJournal(value) {
  const journal = record2(value, "Native transaction journal");
  rejectUnknown2(journal, JOURNAL_KEYS, "Native transaction journal");
  if (journal.schema !== "comet.native.transaction.v1") {
    throw new Error("Unsupported Native transaction schema");
  }
  if (typeof journal.id !== "string" || !/^[a-f0-9-]{8,}$/u.test(journal.id)) {
    throw new Error("Native transaction id is invalid");
  }
  if (journal.kind !== "archive" && journal.kind !== "root-move") {
    throw new Error("Native transaction kind is invalid");
  }
  if (typeof journal.status !== "string" || !TRANSACTION_STATUSES.has(journal.status)) {
    throw new Error("Native transaction status is invalid");
  }
  if (typeof journal.projectRoot !== "string" || !path9.isAbsolute(journal.projectRoot) || typeof journal.nativeRoot !== "string" || !path9.isAbsolute(journal.nativeRoot)) {
    throw new Error("Native transaction roots must be absolute paths");
  }
  if (journal.change !== void 0 && (typeof journal.change !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(journal.change))) {
    throw new Error("Native transaction change name is invalid");
  }
  if (!validTimestamp(journal.createdAt)) {
    throw new Error("Native transaction createdAt is invalid");
  }
  if (!Array.isArray(journal.operations)) {
    throw new Error("Native transaction operations must be an array");
  }
  const operations = journal.operations.map(parseOperation);
  const operationIds = operations.map((operation) => operation.id);
  if (new Set(operationIds).size !== operationIds.length) {
    throw new Error("Native transaction operation ids must be unique");
  }
  return {
    schema: "comet.native.transaction.v1",
    id: journal.id,
    kind: journal.kind,
    status: journal.status,
    projectRoot: journal.projectRoot,
    nativeRoot: journal.nativeRoot,
    ...typeof journal.change === "string" ? { change: journal.change } : {},
    createdAt: journal.createdAt,
    operations
  };
}
function parseEvent(value, line) {
  const event = record2(value, `Native transaction event at line ${line}`);
  rejectUnknown2(event, EVENT_KEYS, `Native transaction event at line ${line}`);
  if (event.sequence !== line) {
    throw new Error(`Native transaction event sequence at line ${line} must be ${line}`);
  }
  if (!validTimestamp(event.timestamp)) {
    throw new Error(`Native transaction event timestamp at line ${line} is invalid`);
  }
  if (typeof event.type !== "string" || !EVENT_TYPES.has(event.type)) {
    throw new Error(`Native transaction event type at line ${line} is invalid`);
  }
  const operationEvent = event.type === "operation-started" || event.type === "operation-completed";
  if (operationEvent && typeof event.operationId !== "string" || !operationEvent && event.operationId !== void 0) {
    throw new Error(`Native transaction event operationId at line ${line} is invalid`);
  }
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    type: event.type,
    ...typeof event.operationId === "string" ? { operationId: event.operationId } : {}
  };
}
function transactionDir(paths, id) {
  if (!/^[a-f0-9-]{8,}$/u.test(id)) throw new Error(`Invalid Native transaction id: ${id}`);
  return path9.join(paths.transactionsDir, id);
}
function nativeTransactionPaths(paths, id) {
  const directory = transactionDir(paths, id);
  return {
    directory,
    journal: path9.join(directory, "transaction.json"),
    events: path9.join(directory, "events.jsonl"),
    staged: path9.join(directory, "staged"),
    backups: path9.join(directory, "backups")
  };
}
async function resolveNativeTransactionPaths(paths, id) {
  const transaction = nativeTransactionPaths(paths, id);
  await Promise.all(
    Object.values(transaction).map(
      (target) => resolveContainedNativePath(paths.nativeRoot, target)
    )
  );
  return transaction;
}
function resolveRefLexically(paths, ref) {
  if (ref.length === 0 || path9.isAbsolute(ref) || /^(?:[A-Za-z]:|~|[\\/])/u.test(ref) || ref.split(/[\\/]/u).includes("..")) {
    throw new Error(`Unsafe Native transaction ref: ${ref}`);
  }
  const target = path9.resolve(paths.nativeRoot, ...ref.split(/[\\/]/u));
  if (!isInsidePath(paths.nativeRoot, target))
    throw new Error(`Unsafe Native transaction ref: ${ref}`);
  return target;
}
async function resolveRef(paths, ref) {
  return resolveContainedNativePath(paths.nativeRoot, resolveRefLexically(paths, ref));
}
async function exists(file) {
  try {
    await fs7.access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function appendEvent(paths, journal, type, operationId) {
  const tx = await resolveNativeTransactionPaths(paths, journal.id);
  const events = await readNativeTransactionEvents(paths, journal.id);
  const event = {
    sequence: events.length + 1,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    type,
    ...operationId ? { operationId } : {}
  };
  await fs7.mkdir(tx.directory, { recursive: true });
  const handle = await fs7.open(tx.events, "a");
  try {
    await handle.writeFile(JSON.stringify(event) + "\n", "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return event;
}
async function createNativeTransaction(paths, journal) {
  journal = parseJournal(journal);
  const tx = await resolveNativeTransactionPaths(paths, journal.id);
  await fs7.mkdir(tx.staged, { recursive: true });
  await fs7.mkdir(tx.backups, { recursive: true });
  await atomicWriteJson(tx.journal, journal);
  await appendEvent(paths, journal, "prepared");
}
async function readNativeTransaction(paths, id) {
  const value = JSON.parse(
    await fs7.readFile((await resolveNativeTransactionPaths(paths, id)).journal, "utf8")
  );
  const journal = parseJournal(value);
  if (journal.id !== id) {
    throw new Error(`Invalid Native transaction journal: ${id}`);
  }
  return journal;
}
async function readNativeTransactionEvents(paths, id) {
  let source;
  try {
    source = await fs7.readFile((await resolveNativeTransactionPaths(paths, id)).events, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const entries = source.split(/\r?\n/u);
  if (entries.at(-1) === "") entries.pop();
  return entries.map((entry2, index) => {
    const line = index + 1;
    try {
      if (entry2.length === 0) throw new Error("Blank transaction event line");
      return parseEvent(JSON.parse(entry2), line);
    } catch (error) {
      throw new Error(`Invalid Native transaction event at line ${line}`, { cause: error });
    }
  });
}
async function setNativeTransactionStatus(paths, journal, status) {
  const updated = parseJournal({ ...journal, status });
  await atomicWriteJson((await resolveNativeTransactionPaths(paths, journal.id)).journal, updated);
  return updated;
}
async function copyAtomic(source, target) {
  const content = await fs7.readFile(source);
  await atomicWriteText(target, content.toString("utf8"));
}
async function backupTarget(paths, operation) {
  if (!operation.backup) return;
  const target = await resolveRef(paths, operation.target);
  const backup = await resolveRef(paths, operation.backup);
  if (!await exists(target) || await exists(backup)) return;
  await fs7.mkdir(path9.dirname(backup), { recursive: true });
  await fs7.copyFile(target, backup);
}
async function applyOperation(paths, operation) {
  const target = await resolveRef(paths, operation.target);
  if (operation.type === "write") {
    if (!operation.staged) throw new Error(`Write operation ${operation.id} has no staged ref`);
    await backupTarget(paths, operation);
    await copyAtomic(await resolveRef(paths, operation.staged), target);
    return;
  }
  if (operation.type === "remove") {
    await backupTarget(paths, operation);
    await fs7.rm(target, { force: true });
    return;
  }
  if (!operation.source) throw new Error(`Move operation ${operation.id} has no source ref`);
  const source = await resolveRef(paths, operation.source);
  const [sourceExists, targetExists] = await Promise.all([exists(source), exists(target)]);
  if (!sourceExists && targetExists) return;
  if (targetExists) throw new Error(`Move target already exists: ${operation.target}`);
  if (!sourceExists) throw new Error(`Move source does not exist: ${operation.source}`);
  await fs7.mkdir(path9.dirname(target), { recursive: true });
  await fs7.rename(source, target);
}
async function applyNativeTransaction(paths, journal, hooks) {
  let current = journal.status === "prepared" ? await setNativeTransactionStatus(paths, journal, "applying") : journal;
  const events = await readNativeTransactionEvents(paths, journal.id);
  const completed = new Set(
    events.filter((event) => event.type === "operation-completed").map((event) => event.operationId)
  );
  let completedCount = completed.size;
  for (const operation of current.operations) {
    if (completed.has(operation.id)) continue;
    await appendEvent(paths, current, "operation-started", operation.id);
    await applyOperation(paths, operation);
    await appendEvent(paths, current, "operation-completed", operation.id);
    completedCount += 1;
    await hooks?.afterOperation?.(operation, completedCount);
  }
  current = await readNativeTransaction(paths, current.id);
  return current;
}
async function rollbackOperation(paths, operation) {
  const target = await resolveRef(paths, operation.target);
  const backup = operation.backup ? await resolveRef(paths, operation.backup) : null;
  if (operation.type === "move") {
    if (!operation.source) throw new Error(`Move operation ${operation.id} has no source ref`);
    const source = await resolveRef(paths, operation.source);
    if (await exists(target)) {
      await fs7.mkdir(path9.dirname(source), { recursive: true });
      await fs7.rename(target, source);
    }
    return;
  }
  if (backup && await exists(backup)) {
    await copyAtomic(backup, target);
  } else {
    await fs7.rm(target, { force: true });
  }
}
async function rollbackNativeTransaction(paths, journal) {
  const events = await readNativeTransactionEvents(paths, journal.id);
  if (events.some(
    (event) => event.type === "archive-finalization-started" || event.type === "archive-finalized"
  )) {
    throw new Error("An archive whose finalization started can only be recovered by continuing it");
  }
  let current = await setNativeTransactionStatus(paths, journal, "rolling-back");
  await appendEvent(paths, current, "rollback-started");
  const started = new Set(
    events.filter((event) => event.type === "operation-started" || event.type === "operation-completed").map((event) => event.operationId)
  );
  for (const operation of [...current.operations].reverse()) {
    if (started.has(operation.id)) await rollbackOperation(paths, operation);
  }
  await appendEvent(paths, current, "rollback-completed");
  current = await setNativeTransactionStatus(paths, current, "rolled-back");
  return current;
}
async function finalizeNativeTransaction(paths, journal, event) {
  await appendEvent(paths, journal, event);
  return event === "commit" ? setNativeTransactionStatus(paths, journal, "committed") : journal;
}
function nativeRootRef(paths, target) {
  const absolute = path9.resolve(target);
  if (!isInsidePath(paths.nativeRoot, absolute)) {
    throw new Error(`Path is outside the Native root: ${target}`);
  }
  return path9.relative(paths.nativeRoot, absolute).split(path9.sep).join("/");
}

// domains/comet-native/native-mutation-lock.ts
async function hasUnfinishedTransaction(paths, allowedTransactionId) {
  let entries;
  try {
    entries = await fs8.readdir(paths.transactionsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  for (const entry2 of entries) {
    if (!entry2.isDirectory() || entry2.isSymbolicLink()) continue;
    try {
      const transaction = await readNativeTransaction(paths, entry2.name);
      if (transaction.id !== allowedTransactionId && transaction.status !== "committed" && transaction.status !== "rolled-back") {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}
async function acquireNativeMutationLock(paths, operation, allowedTransactionId) {
  try {
    return await acquireNativeLock(paths, "root-move", operation);
  } catch (error) {
    const file = path10.join(paths.locksDir, "root-move.lock");
    const diagnosis = await diagnoseNativeLock(file);
    if (diagnosis.status !== "stale") throw error;
    await assertNoPendingNativeRootMove(paths.projectRoot);
    if (await hasUnfinishedTransaction(paths, allowedTransactionId)) throw error;
    await fs8.rm(file, { force: true });
    return acquireNativeLock(paths, "root-move", operation);
  }
}
async function withNativeMutationLock(paths, operation, work, options) {
  const lock = await acquireNativeMutationLock(paths, operation, options?.allowedTransactionId);
  try {
    await assertNoPendingNativeRootMove(paths.projectRoot);
    if (await hasUnfinishedTransaction(paths, options?.allowedTransactionId)) {
      throw new Error("Native transaction recovery is required before another mutation");
    }
    return await work();
  } finally {
    await releaseNativeLock(lock);
  }
}

// domains/comet-native/native-revision.ts
function validRevision(value) {
  return Number.isSafeInteger(value) && value >= 1;
}
async function compareAndSwapNativeRevision(options) {
  if (!validRevision(options.expectedRevision)) {
    throw new Error("Native expected revision must be a positive integer");
  }
  if (options.next.revision !== options.expectedRevision + 1) {
    throw new Error("Native CAS next revision must increment the expected revision exactly once");
  }
  const current = await options.read();
  if (!validRevision(current.revision)) {
    throw new Error("Native current revision must be a positive integer");
  }
  const equals = options.equals ?? ((left, right) => JSON.stringify(left) === JSON.stringify(right));
  if (current.revision === options.next.revision && equals(current, options.next)) {
    return current;
  }
  if (current.revision !== options.expectedRevision) {
    throw options.conflict(current.revision);
  }
  await options.write(options.next);
  return options.next;
}

// domains/comet-native/native-snapshot.ts
import { createHash as createHash3 } from "crypto";
import { promises as fs9 } from "fs";
import path12 from "path";

// domains/comet-native/native-hash.ts
import { createHash as createHash2 } from "crypto";
import { createReadStream } from "fs";
async function sha256File(file) {
  const hash = createHash2("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function sha256Text(content) {
  return createHash2("sha256").update(content).digest("hex");
}

// domains/comet-native/native-sensitive-paths.ts
import path11 from "path";
var NATIVE_EXCLUDED_DIRECTORY_NAMES = /* @__PURE__ */ new Set([
  ".cache",
  ".git",
  ".gradle",
  ".mypy_cache",
  ".next",
  ".npm",
  ".pnpm-store",
  ".pytest_cache",
  ".turbo",
  ".venv",
  ".yarn",
  "__pycache__",
  "node_modules",
  "venv"
]);
function isNativeEnvFileName(name) {
  return name.toLowerCase().startsWith(".env");
}
function nativeSensitiveRelativePathReason(relativeRef) {
  const segments = relativeRef.replaceAll("\\", "/").split("/").filter(Boolean);
  const lower = segments.map((segment) => segment.toLowerCase());
  if (lower.some((segment) => isNativeEnvFileName(segment))) return "environment-file";
  if (lower.includes(".git")) return "git-metadata";
  if (lower.some((segment) => NATIVE_EXCLUDED_DIRECTORY_NAMES.has(segment))) {
    return "dependency-or-cache";
  }
  if (lower.join("/") === "comet.config.yaml") return "comet-config";
  return null;
}
function nativeSensitiveArtifactReason(paths, relativeRef) {
  const generic = nativeSensitiveRelativePathReason(relativeRef);
  if (generic) return generic;
  const target = path11.resolve(paths.projectRoot, ...relativeRef.split("/"));
  const relativeNativeRoot = path11.relative(paths.projectRoot, paths.nativeRoot).replaceAll("\\", "/");
  const normalized = relativeRef.replaceAll("\\", "/");
  if (normalized === relativeNativeRoot || normalized.startsWith(`${relativeNativeRoot}/`) || target === path11.resolve(paths.configFile)) {
    return "native-runtime";
  }
  return null;
}

// domains/comet-native/native-snapshot.ts
var DEFAULT_NATIVE_SNAPSHOT_LIMITS = {
  maxFiles: 1e4,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024
};
var MAX_RECORDED_OMISSIONS = 1e3;
var CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
var MANIFEST_KEYS = /* @__PURE__ */ new Set([
  "schema",
  "origin",
  "createdAt",
  "complete",
  "limits",
  "entries",
  "omitted",
  "omittedCount",
  "omissionOverflow"
]);
var LIMIT_KEYS = /* @__PURE__ */ new Set(["maxFiles", "maxFileBytes", "maxTotalBytes", "maxManifestBytes"]);
var ENTRY_KEYS = /* @__PURE__ */ new Set(["path", "hash", "size", "type"]);
var OMISSION_KEYS = /* @__PURE__ */ new Set(["path", "size", "type", "reason"]);
var OMISSION_OVERFLOW_KEYS = /* @__PURE__ */ new Set(["ref", "hash", "count"]);
var SNAPSHOT_ORIGINS = /* @__PURE__ */ new Set([
  "change-created",
  "legacy-migration",
  "explicit"
]);
var OMISSION_TYPES = /* @__PURE__ */ new Set(["file", "directory", "other"]);
var OMISSION_REASONS = /* @__PURE__ */ new Set([
  "file-size",
  "file-count",
  "total-size",
  "manifest-size",
  "changed-during-read",
  "unreadable"
]);
var HASH_PATTERN = /^[a-f0-9]{64}$/u;
var UNREADABLE_ERROR_CODES = /* @__PURE__ */ new Set(["EACCES", "EPERM"]);
function portableRelative(root, target) {
  return path12.relative(root, target).split(path12.sep).join("/");
}
function normalizedDenylist(projectRoot, values) {
  return values.map((value) => path12.resolve(projectRoot, ...value.split(/[\\/]/u)));
}
function sameOrInside(root, target) {
  const normalizedRoot = path12.resolve(root);
  const normalizedTarget = path12.resolve(target);
  return normalizedTarget === normalizedRoot || isInsidePath(normalizedRoot, normalizedTarget);
}
function isUnreadableError(error) {
  return UNREADABLE_ERROR_CODES.has(error.code ?? "");
}
function isChangedDuringReadError(error) {
  return error.code === "ENOENT";
}
function serializedManifestBytes(manifest) {
  return Buffer.byteLength(JSON.stringify(manifest, null, 2) + "\n");
}
function sameFileIdentity2(left, right) {
  if (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.birthtimeMs === right.birthtimeMs && left.ctimeMs === right.ctimeMs && left.size === right.size;
}
async function sha256FileBounded(file, maxBytes, expected) {
  const handle = await fs9.open(file, "r");
  const hash = createHash3("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
  let bytes = 0;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileIdentity2(expected, opened)) return { status: "changed" };
    while (true) {
      const remaining = maxBytes + 1 - bytes;
      if (remaining < 1) return { status: "changed" };
      const result2 = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
      if (result2.bytesRead === 0) {
        const finalStat = await handle.stat();
        if (!finalStat.isFile() || !sameFileIdentity2(opened, finalStat)) {
          return { status: "changed" };
        }
        return { status: "complete", hash: hash.digest("hex"), bytes, finalStat };
      }
      if (bytes + result2.bytesRead > maxBytes) return { status: "changed" };
      hash.update(buffer.subarray(0, result2.bytesRead));
      bytes += result2.bytesRead;
    }
  } finally {
    await handle.close();
  }
}
function omissionType(child) {
  if (child.isFile()) return "file";
  if (child.isDirectory()) return "directory";
  return "other";
}
function record3(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}
function rejectUnknown3(value, keys, label) {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown) throw new Error(`${label} contains unknown field: ${unknown}`);
}
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}
function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}
function snapshotPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) {
    throw new Error(`${label} must be a normalized project-relative path`);
  }
  const normalized = path12.posix.normalize(value);
  if (normalized !== value || path12.posix.isAbsolute(value) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} must stay inside the project root`);
  }
  return value;
}
function parseEntry(value, index) {
  const entry2 = record3(value, `Native snapshot entry ${index}`);
  rejectUnknown3(entry2, ENTRY_KEYS, `Native snapshot entry ${index}`);
  const entryPath = snapshotPath(entry2.path, `Native snapshot entry ${index} path`);
  if (typeof entry2.hash !== "string" || !HASH_PATTERN.test(entry2.hash)) {
    throw new Error(`Native snapshot entry ${index} hash is invalid`);
  }
  if (entry2.type !== "file") throw new Error(`Native snapshot entry ${index} type is invalid`);
  return {
    path: entryPath,
    hash: entry2.hash,
    size: nonNegativeInteger(entry2.size, `Native snapshot entry ${index} size`),
    type: "file"
  };
}
function parseOmission(value, index) {
  const omission = record3(value, `Native snapshot omission ${index}`);
  rejectUnknown3(omission, OMISSION_KEYS, `Native snapshot omission ${index}`);
  if (!OMISSION_TYPES.has(omission.type)) {
    throw new Error(`Native snapshot omission ${index} type is invalid`);
  }
  if (!OMISSION_REASONS.has(omission.reason)) {
    throw new Error(`Native snapshot omission ${index} reason is invalid`);
  }
  return {
    path: snapshotPath(omission.path, `Native snapshot omission ${index} path`),
    size: omission.size === null ? null : nonNegativeInteger(omission.size, `Native snapshot omission ${index} size`),
    type: omission.type,
    reason: omission.reason
  };
}
function parseOmissionOverflow(value) {
  const overflow = record3(value, "Native snapshot omission overflow");
  rejectUnknown3(overflow, OMISSION_OVERFLOW_KEYS, "Native snapshot omission overflow");
  if (typeof overflow.hash !== "string" || !HASH_PATTERN.test(overflow.hash)) {
    throw new Error("Native snapshot omission overflow hash is invalid");
  }
  const expectedRef = `native-snapshot://omitted-overflow/${overflow.hash}`;
  if (overflow.ref !== expectedRef) {
    throw new Error("Native snapshot omission overflow ref is invalid");
  }
  return {
    ref: expectedRef,
    hash: overflow.hash,
    count: positiveInteger(overflow.count, "Native snapshot omission overflow count")
  };
}
function parseNativeContentSnapshotManifest(value) {
  const manifest = record3(value, "Native content snapshot manifest");
  rejectUnknown3(manifest, MANIFEST_KEYS, "Native content snapshot manifest");
  if (manifest.schema !== "comet.native.content-snapshot.v1") {
    throw new Error("Unsupported Native content snapshot schema");
  }
  if (!SNAPSHOT_ORIGINS.has(manifest.origin)) {
    throw new Error("Native content snapshot origin is invalid");
  }
  if (typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error("Native content snapshot timestamp is invalid");
  }
  if (typeof manifest.complete !== "boolean") {
    throw new Error("Native content snapshot complete flag is invalid");
  }
  const limitValue = record3(manifest.limits, "Native content snapshot limits");
  rejectUnknown3(limitValue, LIMIT_KEYS, "Native content snapshot limits");
  const limits = {
    maxFiles: positiveInteger(limitValue.maxFiles, "Native snapshot maxFiles"),
    maxFileBytes: positiveInteger(limitValue.maxFileBytes, "Native snapshot maxFileBytes"),
    maxTotalBytes: positiveInteger(limitValue.maxTotalBytes, "Native snapshot maxTotalBytes"),
    maxManifestBytes: positiveInteger(
      limitValue.maxManifestBytes,
      "Native snapshot maxManifestBytes"
    )
  };
  if (!Array.isArray(manifest.entries) || !Array.isArray(manifest.omitted)) {
    throw new Error("Native content snapshot entries and omissions must be arrays");
  }
  const entries = manifest.entries.map(parseEntry);
  const omitted = manifest.omitted.map(parseOmission);
  const omittedCount = nonNegativeInteger(
    manifest.omittedCount,
    "Native content snapshot omittedCount"
  );
  const omissionOverflow = manifest.omissionOverflow === void 0 ? void 0 : parseOmissionOverflow(manifest.omissionOverflow);
  if (entries.length > limits.maxFiles) {
    throw new Error("Native content snapshot exceeds its file-count limit");
  }
  if (entries.some((entry2) => entry2.size > limits.maxFileBytes) || entries.reduce((total, entry2) => total + entry2.size, 0) > limits.maxTotalBytes) {
    throw new Error("Native content snapshot exceeds its byte limits");
  }
  if (new Set(entries.map((entry2) => entry2.path)).size !== entries.length) {
    throw new Error("Native content snapshot contains duplicate paths");
  }
  if (omitted.length > MAX_RECORDED_OMISSIONS || omittedCount < omitted.length) {
    throw new Error("Native content snapshot omission count is invalid");
  }
  const overflowCount = omittedCount - omitted.length;
  if (overflowCount === 0 && omissionOverflow || overflowCount > 0 && omissionOverflow?.count !== overflowCount) {
    throw new Error("Native content snapshot omission overflow is inconsistent");
  }
  if (manifest.complete !== (omittedCount === 0)) {
    throw new Error("Native content snapshot completeness is inconsistent");
  }
  const parsed = {
    schema: "comet.native.content-snapshot.v1",
    origin: manifest.origin,
    createdAt: manifest.createdAt,
    complete: manifest.complete,
    limits,
    entries,
    omitted,
    omittedCount,
    ...omissionOverflow ? { omissionOverflow } : {}
  };
  if (serializedManifestBytes(parsed) > limits.maxManifestBytes) {
    throw new Error("Native content snapshot exceeds its manifest byte limit");
  }
  return parsed;
}
function nativeBaselineManifestFile(paths, name) {
  if (!CHANGE_NAME_PATTERN.test(name)) throw new Error(`Invalid Native change name: ${name}`);
  const changeDir = path12.join(paths.changesDir, name);
  if (!isInsidePath(paths.changesDir, changeDir)) throw new Error("Native change path escaped");
  return path12.join(changeDir, "runtime", "baseline-manifest.json");
}
async function createNativeContentSnapshot(paths, options = {}) {
  const limits = {
    maxFiles: options.limits?.maxFiles ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxFiles,
    maxFileBytes: options.limits?.maxFileBytes ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxFileBytes,
    maxTotalBytes: options.limits?.maxTotalBytes ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxTotalBytes,
    maxManifestBytes: options.limits?.maxManifestBytes ?? DEFAULT_NATIVE_SNAPSHOT_LIMITS.maxManifestBytes
  };
  if (limits.maxFiles < 1 || limits.maxFileBytes < 1 || limits.maxTotalBytes < 1 || limits.maxManifestBytes < 1) {
    throw new Error("Native snapshot limits must be positive");
  }
  const projectRoot = path12.resolve(paths.projectRoot);
  const physicalProjectRoot = await fs9.realpath(projectRoot);
  const nativeRoot = path12.resolve(paths.nativeRoot);
  const physicalNativeRoot = await fs9.realpath(nativeRoot);
  const configFile = path12.resolve(paths.configFile);
  const denylist = normalizedDenylist(projectRoot, options.denylist ?? []);
  const entries = [];
  const omitted = [];
  let omittedCount = 0;
  let overflowCount = 0;
  let overflowHash = sha256Text("comet.native.snapshot-omission-overflow.v1");
  let totalBytes = 0;
  const foldOverflow = (value) => {
    overflowCount += 1;
    overflowHash = sha256Text(`${overflowHash}
${JSON.stringify(value)}`);
  };
  const omit = (value) => {
    omittedCount += 1;
    if (omitted.length < MAX_RECORDED_OMISSIONS) {
      omitted.push(value);
      return;
    }
    foldOverflow(value);
  };
  const visit = async (directory) => {
    let children;
    try {
      children = (await fs9.readdir(directory, { withFileTypes: true })).sort(
        (left, right) => left.name.localeCompare(right.name, "en")
      );
    } catch (error) {
      if (directory === projectRoot) throw error;
      if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
      omit({
        path: portableRelative(projectRoot, directory),
        size: null,
        type: "directory",
        reason: isChangedDuringReadError(error) ? "changed-during-read" : "unreadable"
      });
      return;
    }
    for (const child of children) {
      const target = path12.join(directory, child.name);
      const relative = portableRelative(projectRoot, target);
      if (target === configFile || sameOrInside(nativeRoot, target) || denylist.some((denied) => sameOrInside(denied, target)) || isNativeEnvFileName(child.name) || child.name.toLowerCase() === ".git") {
        continue;
      }
      let before;
      try {
        before = await fs9.lstat(target);
      } catch (error) {
        if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
        omit({
          path: relative,
          size: null,
          type: omissionType(child),
          reason: isChangedDuringReadError(error) ? "changed-during-read" : "unreadable"
        });
        continue;
      }
      if (child.isSymbolicLink() || before.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        if (!before.isDirectory()) continue;
        if (NATIVE_EXCLUDED_DIRECTORY_NAMES.has(child.name.toLowerCase())) continue;
        let realDirectory;
        try {
          realDirectory = await fs9.realpath(target);
        } catch (error) {
          if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
          omit({
            path: relative,
            size: null,
            type: "directory",
            reason: isChangedDuringReadError(error) ? "changed-during-read" : "unreadable"
          });
          continue;
        }
        if (!isInsidePath(physicalProjectRoot, realDirectory) || sameOrInside(physicalNativeRoot, realDirectory)) {
          continue;
        }
        await visit(target);
        continue;
      }
      if (!child.isFile()) continue;
      if (!before.isFile() || before.isSymbolicLink()) continue;
      let realTarget;
      try {
        realTarget = await fs9.realpath(target);
      } catch (error) {
        if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
        omit({
          path: relative,
          size: before.size,
          type: "file",
          reason: isChangedDuringReadError(error) ? "changed-during-read" : "unreadable"
        });
        continue;
      }
      if (!isInsidePath(physicalProjectRoot, realTarget) || sameOrInside(physicalNativeRoot, realTarget)) {
        continue;
      }
      if (entries.length >= limits.maxFiles) {
        omit({ path: relative, size: before.size, type: "file", reason: "file-count" });
        continue;
      }
      if (before.size > limits.maxFileBytes) {
        omit({ path: relative, size: before.size, type: "file", reason: "file-size" });
        continue;
      }
      if (totalBytes + before.size > limits.maxTotalBytes) {
        omit({ path: relative, size: before.size, type: "file", reason: "total-size" });
        continue;
      }
      let boundedHash;
      let after;
      let afterRealTarget;
      try {
        boundedHash = await sha256FileBounded(realTarget, before.size, before);
        if (boundedHash.status === "changed") {
          omit({
            path: relative,
            size: null,
            type: "file",
            reason: "changed-during-read"
          });
          continue;
        }
        afterRealTarget = await fs9.realpath(target);
        after = await fs9.lstat(target);
      } catch (error) {
        if (!isUnreadableError(error) && !isChangedDuringReadError(error)) throw error;
        omit({
          path: relative,
          size: before.size,
          type: "file",
          reason: isChangedDuringReadError(error) ? "changed-during-read" : "unreadable"
        });
        continue;
      }
      if (boundedHash.bytes !== before.size || afterRealTarget !== realTarget || !sameFileIdentity2(before, boundedHash.finalStat) || !sameFileIdentity2(boundedHash.finalStat, after) || !after.isFile() || after.isSymbolicLink() || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        omit({
          path: relative,
          size: after.isFile() ? after.size : null,
          type: after.isFile() ? "file" : "other",
          reason: "changed-during-read"
        });
        continue;
      }
      entries.push({ path: relative, hash: boundedHash.hash, size: after.size, type: "file" });
      totalBytes += after.size;
    }
  };
  await visit(projectRoot);
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  omitted.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const buildManifest = () => ({
    schema: "comet.native.content-snapshot.v1",
    origin: options.origin ?? "explicit",
    createdAt: (options.now ?? /* @__PURE__ */ new Date()).toISOString(),
    complete: omittedCount === 0,
    limits,
    entries,
    omitted,
    omittedCount,
    ...overflowCount > 0 ? {
      omissionOverflow: {
        ref: `native-snapshot://omitted-overflow/${overflowHash}`,
        hash: overflowHash,
        count: overflowCount
      }
    } : {}
  });
  let manifest = buildManifest();
  while (serializedManifestBytes(manifest) > limits.maxManifestBytes) {
    if (omitted.length > 0) {
      const removeCount = Math.max(1, Math.ceil(omitted.length / 4));
      for (const value of omitted.splice(-removeCount)) foldOverflow(value);
    } else if (entries.length > 0) {
      const removeCount = Math.max(1, Math.ceil(entries.length / 4));
      for (const entry2 of entries.splice(-removeCount)) {
        omittedCount += 1;
        foldOverflow({
          path: entry2.path,
          size: entry2.size,
          type: "file",
          reason: "manifest-size"
        });
      }
    } else {
      throw new Error("Native snapshot manifest byte limit is too small for its metadata");
    }
    manifest = buildManifest();
  }
  return manifest;
}
async function writeNativeBaselineManifest(paths, name, manifest) {
  const file = nativeBaselineManifestFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  await atomicWriteJson(file, parseNativeContentSnapshotManifest(manifest));
}
async function readNativeBaselineManifest(paths, name) {
  const file = nativeBaselineManifestFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    return parseNativeContentSnapshotManifest(JSON.parse(await fs9.readFile(file, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// domains/comet-native/native-trajectory-recovery.ts
import { createHash as createHash4 } from "crypto";
import { promises as fs10 } from "fs";
import path13 from "path";
var CHANGE_NAME_PATTERN2 = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
var NativeTrajectoryRepairRequiredError = class extends Error {
  constructor(inspection) {
    super(
      inspection.status === "repairable" ? `Native trajectory has an incomplete final line at ${inspection.file}:${inspection.line}; run doctor --repair` : `Native trajectory is invalid at ${inspection.file}:${inspection.line}: ${inspection.message}`
    );
    this.inspection = inspection;
    this.name = "NativeTrajectoryRepairRequiredError";
  }
  inspection;
  code = "native-trajectory-tail-repair-required";
};
function sha256Buffer(value) {
  return createHash4("sha256").update(value).digest("hex");
}
function trajectoryFile(paths, name) {
  if (!CHANGE_NAME_PATTERN2.test(name)) throw new Error(`Invalid Native change name: ${name}`);
  const changeDir = path13.join(paths.changesDir, name);
  if (!isInsidePath(paths.changesDir, changeDir)) throw new Error("Native change path escaped");
  return path13.join(changeDir, "runtime", "trajectory.jsonl");
}
function parseCompleteLines(content) {
  const lines = content.split(/\n/u);
  let count = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].endsWith("\r") ? lines[index].slice(0, -1) : lines[index];
    if (line.length === 0) continue;
    count = index + 1;
    try {
      JSON.parse(line);
    } catch (error) {
      return { status: "invalid", line: index + 1, message: error.message };
    }
  }
  return { status: "valid", count };
}
function looksTruncated(error, content) {
  if (/Unexpected end|Unterminated string/iu.test(error.message)) return true;
  const position = /position (\d+)/iu.exec(error.message)?.[1];
  return position !== void 0 && Number(position) >= Math.max(0, content.length - 1);
}
function analyzeTrajectory(file, source) {
  const lastNewline = source.lastIndexOf(10);
  const prefix = source.subarray(0, lastNewline + 1);
  const complete = parseCompleteLines(prefix.toString("utf8"));
  if (complete.status === "invalid") {
    return { status: "invalid", file, line: complete.line, message: complete.message };
  }
  if (lastNewline === source.length - 1) return { status: "clean", file };
  const tail = source.subarray(lastNewline + 1);
  const tailText = tail.toString("utf8");
  const line = complete.count + 1;
  let reason;
  let target;
  try {
    JSON.parse(tailText.endsWith("\r") ? tailText.slice(0, -1) : tailText);
    reason = "missing-newline";
    target = Buffer.concat([source, Buffer.from("\n")]);
  } catch (error) {
    if (!looksTruncated(error, tailText)) {
      return { status: "invalid", file, line, message: error.message };
    }
    reason = "incomplete-json";
    target = prefix;
  }
  const inspection = {
    status: "repairable",
    file,
    reason,
    line,
    originalHash: sha256Buffer(source),
    targetHash: sha256Buffer(target),
    tailHash: sha256Buffer(tail),
    discardedBytes: reason === "incomplete-json" ? tail.length : 0
  };
  return { inspection, targetContent: target.toString("utf8") };
}
async function inspectFile(paths, name) {
  const file = trajectoryFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    return analyzeTrajectory(file, await fs10.readFile(file));
  } catch (error) {
    if (error.code === "ENOENT") return { status: "clean", file };
    throw error;
  }
}
async function inspectNativeTrajectoryTail(paths, name) {
  const result2 = await inspectFile(paths, name);
  return "inspection" in result2 ? result2.inspection : result2;
}
async function assertNativeTrajectoryHealthy(paths, name) {
  const inspection = await inspectNativeTrajectoryTail(paths, name);
  if (inspection.status !== "clean") throw new NativeTrajectoryRepairRequiredError(inspection);
}
async function repairNativeTrajectoryTail(paths, name) {
  return withNativeMutationLock(paths, `repair trajectory tail for ${name}`, async () => {
    const result2 = await inspectFile(paths, name);
    if (!("inspection" in result2)) {
      if (result2.status === "clean") return null;
      throw new NativeTrajectoryRepairRequiredError(result2);
    }
    const current = await fs10.readFile(result2.inspection.file);
    if (sha256Buffer(current) !== result2.inspection.originalHash) {
      throw new Error(
        `Native trajectory changed while preparing tail repair for ${name}; inspect it again before retrying`
      );
    }
    await atomicWriteText(result2.inspection.file, result2.targetContent);
    const repaired = await inspectNativeTrajectoryTail(paths, name);
    if (repaired.status !== "clean") {
      throw new Error(`Native trajectory tail repair did not produce a clean file for ${name}`);
    }
    return result2.inspection;
  });
}

// domains/comet-native/native-types.ts
var NATIVE_RUNTIME_PROTOCOL_VERSION = 2;
var NATIVE_CHANGE_SCHEMA = "comet.native.v2";
var NATIVE_LEGACY_CHANGE_SCHEMA = "comet.native.v1";
var NATIVE_TRANSITION_SCHEMA = "comet.native.transition.v2";
var NATIVE_LEGACY_TRANSITION_SCHEMA = "comet.native.transition.v1";

// domains/comet-native/native-change.ts
var CHANGE_KEYS = [
  "schema",
  "name",
  "language",
  "phase",
  "brief",
  "approval",
  "spec_changes",
  "verification_result",
  "verification_report",
  "archived",
  "created_at",
  "run_id"
];
var LEGACY_CHANGE_KEYS = new Set(CHANGE_KEYS);
var CURRENT_CHANGE_KEYS = /* @__PURE__ */ new Set([
  ...CHANGE_KEYS,
  "minimum_runtime_version",
  "revision"
]);
var SPEC_CHANGE_KEYS = /* @__PURE__ */ new Set(["capability", "operation", "source", "base_hash"]);
var PHASES = /* @__PURE__ */ new Set(["shape", "build", "verify", "archive"]);
var APPROVALS = /* @__PURE__ */ new Set(["implicit", "confirmed"]);
var VERIFY_RESULTS = /* @__PURE__ */ new Set(["pending", "pass", "fail"]);
var HASH_PATTERN2 = /^[a-f0-9]{64}$/u;
var NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
var NativeSchemaMigrationRequiredError = class extends Error {
  constructor(change, schema) {
    super(
      `Native change ${change} uses ${schema}; run comet native doctor ${change} --repair before mutating it`
    );
    this.change = change;
    this.schema = schema;
    this.name = "NativeSchemaMigrationRequiredError";
  }
  change;
  schema;
  code = "native-schema-migration-required";
};
var NativeRuntimeCompatibilityError = class extends Error {
  constructor(schema, minimumRuntimeVersion) {
    super(
      schema !== NATIVE_CHANGE_SCHEMA || minimumRuntimeVersion === null ? `Unsupported Native change schema ${schema} for runtime protocol ${NATIVE_RUNTIME_PROTOCOL_VERSION}` : `Native change ${schema} requires runtime protocol ${minimumRuntimeVersion}; current protocol is ${NATIVE_RUNTIME_PROTOCOL_VERSION}`
    );
    this.schema = schema;
    this.minimumRuntimeVersion = minimumRuntimeVersion;
    this.name = "NativeRuntimeCompatibilityError";
  }
  schema;
  minimumRuntimeVersion;
  code = "native-runtime-incompatible";
};
var NativeChangeRevisionConflictError = class extends Error {
  constructor(change, expectedRevision, actualRevision) {
    super(
      `Native change ${change} revision conflict: expected ${expectedRevision}, actual ${actualRevision}`
    );
    this.change = change;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
    this.name = "NativeChangeRevisionConflictError";
  }
  change;
  expectedRevision;
  actualRevision;
  code = "native-change-revision-conflict";
};
var NATIVE_BRIEF_TEMPLATE = [
  "# Outcome",
  "",
  "# Scope",
  "",
  "# Non-goals",
  "",
  "# Acceptance examples",
  "",
  "# Constraints and invariants",
  "",
  "# Decisions",
  "",
  "# Open questions",
  "",
  "# Verification expectations",
  ""
].join("\n");
function record4(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value;
}
function rejectUnknown4(value, known, label) {
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(", ")}`);
}
function assertNativeName(value) {
  if (!NAME_PATTERN.test(value)) throw new Error(`Invalid Native change name: ${value}`);
}
function assertCapabilityId(value) {
  if (!NAME_PATTERN.test(value)) throw new Error(`Invalid Native capability id: ${value}`);
}
function assertRelativeRef(value, label) {
  if (value.length === 0 || path14.isAbsolute(value) || /^(?:[A-Za-z]:|~|[\\/])/u.test(value) || value.split(/[\\/]/u).includes("..")) {
    throw new Error(`${label} must stay inside the Native change`);
  }
}
function parseSpecChange(value, index) {
  const item = record4(value, `spec_changes[${index}]`);
  rejectUnknown4(item, SPEC_CHANGE_KEYS, `spec_changes[${index}]`);
  if (typeof item.capability !== "string") throw new Error("spec change capability is required");
  assertCapabilityId(item.capability);
  if (item.operation !== "create" && item.operation !== "replace" && item.operation !== "remove") {
    throw new Error(`Invalid spec operation for ${item.capability}`);
  }
  const source = item.source;
  const baseHash = item.base_hash;
  if (source !== void 0 && typeof source !== "string") {
    throw new Error(`Spec source for ${item.capability} must be a string`);
  }
  if (typeof source === "string") assertRelativeRef(source, `Spec source for ${item.capability}`);
  if (item.operation === "create") {
    if (!source) throw new Error(`Create spec ${item.capability} requires source`);
    if (baseHash !== null)
      throw new Error(`Create spec ${item.capability} requires null base_hash`);
  } else if (item.operation === "replace") {
    if (!source) throw new Error(`Replace spec ${item.capability} requires source`);
    if (typeof baseHash !== "string" || !HASH_PATTERN2.test(baseHash)) {
      throw new Error(`Replace spec ${item.capability} requires a SHA-256 base_hash`);
    }
  } else {
    if (source !== void 0) throw new Error(`Remove spec ${item.capability} forbids source`);
    if (typeof baseHash !== "string" || !HASH_PATTERN2.test(baseHash)) {
      throw new Error(`Remove spec ${item.capability} requires a SHA-256 base_hash`);
    }
  }
  return {
    capability: item.capability,
    operation: item.operation,
    ...typeof source === "string" ? { source } : {},
    base_hash: baseHash
  };
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  return (/* @__PURE__ */ new Date(`${value}T00:00:00.000Z`)).toISOString().slice(0, 10) === value;
}
function parseChangeFields(root, knownKeys) {
  rejectUnknown4(root, knownKeys, "change.yaml");
  if (typeof root.name !== "string") throw new Error("Native change name is required");
  assertNativeName(root.name);
  if (root.language !== "en" && root.language !== "zh-CN") {
    throw new Error("Native change language must be en or zh-CN");
  }
  if (typeof root.phase !== "string" || !PHASES.has(root.phase)) {
    throw new Error("Native change phase is invalid");
  }
  if (root.brief !== "brief.md") throw new Error("Native change brief must be brief.md");
  if (root.approval !== null && !APPROVALS.has(root.approval)) {
    throw new Error("Native change approval is invalid");
  }
  if (!Array.isArray(root.spec_changes)) throw new Error("Native spec_changes must be an array");
  const specChanges = root.spec_changes.map(parseSpecChange);
  const duplicates = specChanges.map((change) => change.capability).filter((capability, index, all) => all.indexOf(capability) !== index);
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate Native capability operation: ${[...new Set(duplicates)].join(", ")}`
    );
  }
  if (typeof root.verification_result !== "string" || !VERIFY_RESULTS.has(root.verification_result)) {
    throw new Error("Native verification_result is invalid");
  }
  if (root.verification_report !== null && typeof root.verification_report !== "string") {
    throw new Error("Native verification_report must be a string or null");
  }
  if (typeof root.verification_report === "string") {
    assertRelativeRef(root.verification_report, "Native verification_report");
  }
  if (typeof root.archived !== "boolean") throw new Error("Native archived must be boolean");
  if (typeof root.created_at !== "string" || !validDate(root.created_at)) {
    throw new Error("Native created_at must be a valid YYYY-MM-DD date");
  }
  if (root.run_id !== null && (typeof root.run_id !== "string" || root.run_id.length === 0)) {
    throw new Error("Native run_id must be a non-empty string or null");
  }
  return {
    name: root.name,
    language: root.language,
    phase: root.phase,
    brief: "brief.md",
    approval: root.approval,
    spec_changes: specChanges,
    verification_result: root.verification_result,
    verification_report: root.verification_report,
    archived: root.archived,
    created_at: root.created_at,
    run_id: root.run_id
  };
}
function parseLegacyNativeChangeValue(value) {
  const root = record4(value, "change.yaml");
  if (root.schema !== NATIVE_LEGACY_CHANGE_SCHEMA) {
    throw new Error(`Expected ${NATIVE_LEGACY_CHANGE_SCHEMA}`);
  }
  return {
    schema: NATIVE_LEGACY_CHANGE_SCHEMA,
    ...parseChangeFields(root, LEGACY_CHANGE_KEYS)
  };
}
function positiveInteger2(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}
function parseNativeChangeValue(value) {
  const root = record4(value, "change.yaml");
  if (root.schema !== NATIVE_CHANGE_SCHEMA) {
    if (root.schema === NATIVE_LEGACY_CHANGE_SCHEMA) {
      const legacy = parseLegacyNativeChangeValue(root);
      throw new NativeSchemaMigrationRequiredError(legacy.name, legacy.schema);
    }
    throw new NativeRuntimeCompatibilityError(
      typeof root.schema === "string" ? root.schema : "(missing)",
      typeof root.minimum_runtime_version === "number" ? root.minimum_runtime_version : null
    );
  }
  const minimumRuntimeVersion = positiveInteger2(
    root.minimum_runtime_version,
    "Native minimum_runtime_version"
  );
  if (minimumRuntimeVersion > NATIVE_RUNTIME_PROTOCOL_VERSION) {
    throw new NativeRuntimeCompatibilityError(root.schema, minimumRuntimeVersion);
  }
  if (minimumRuntimeVersion !== NATIVE_RUNTIME_PROTOCOL_VERSION) {
    throw new Error(
      `Native ${root.schema} minimum_runtime_version must be ${NATIVE_RUNTIME_PROTOCOL_VERSION}`
    );
  }
  const revision = positiveInteger2(root.revision, "Native revision");
  return {
    schema: NATIVE_CHANGE_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision,
    ...parseChangeFields(root, CURRENT_CHANGE_KEYS)
  };
}
function inspectNativeChangeValue(value) {
  const root = record4(value, "change.yaml");
  if (root.schema === NATIVE_LEGACY_CHANGE_SCHEMA) {
    const state2 = parseLegacyNativeChangeValue(root);
    return {
      status: "migration-required",
      schema: state2.schema,
      minimumRuntimeVersion: 1,
      state: state2,
      message: `Native change ${state2.name} requires migration to ${NATIVE_CHANGE_SCHEMA}`
    };
  }
  if (root.schema !== NATIVE_CHANGE_SCHEMA) {
    const minimumRuntimeVersion2 = typeof root.minimum_runtime_version === "number" && Number.isSafeInteger(root.minimum_runtime_version) ? root.minimum_runtime_version : null;
    return {
      status: "runtime-incompatible",
      schema: typeof root.schema === "string" ? root.schema : "(missing)",
      minimumRuntimeVersion: minimumRuntimeVersion2,
      state: null,
      message: new NativeRuntimeCompatibilityError(
        typeof root.schema === "string" ? root.schema : "(missing)",
        minimumRuntimeVersion2
      ).message
    };
  }
  const minimumRuntimeVersion = positiveInteger2(
    root.minimum_runtime_version,
    "Native minimum_runtime_version"
  );
  if (minimumRuntimeVersion > NATIVE_RUNTIME_PROTOCOL_VERSION) {
    return {
      status: "runtime-incompatible",
      schema: root.schema,
      minimumRuntimeVersion,
      state: null,
      message: new NativeRuntimeCompatibilityError(root.schema, minimumRuntimeVersion).message
    };
  }
  const state = parseNativeChangeValue(root);
  return {
    status: "current",
    schema: state.schema,
    minimumRuntimeVersion: state.minimum_runtime_version,
    state
  };
}
function nativeChangeDocument(state) {
  const parsed = parseNativeChangeValue(state);
  return {
    schema: parsed.schema,
    minimum_runtime_version: parsed.minimum_runtime_version,
    revision: parsed.revision,
    name: parsed.name,
    language: parsed.language,
    phase: parsed.phase,
    brief: parsed.brief,
    approval: parsed.approval,
    spec_changes: parsed.spec_changes.map((change) => ({
      capability: change.capability,
      operation: change.operation,
      ...change.source ? { source: change.source } : {},
      base_hash: change.base_hash
    })),
    verification_result: parsed.verification_result,
    verification_report: parsed.verification_report,
    archived: parsed.archived,
    created_at: parsed.created_at,
    run_id: parsed.run_id
  };
}
function nativeChangeDir(paths, name) {
  assertNativeName(name);
  const target = path14.join(paths.changesDir, name);
  if (!isInsidePath(paths.changesDir, target)) throw new Error("Native change path escaped");
  return target;
}
async function hasPendingNativeSchemaMigration(paths, name) {
  const file = path14.join(nativeChangeDir(paths, name), "runtime", "schema-migration.json");
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    await fs11.lstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function hasPendingNativeCheckpointRecovery(paths, name) {
  const file = path14.join(nativeChangeDir(paths, name), "runtime", "checkpoint-journal.json");
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    await fs11.lstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function createNativeChange(options) {
  return withNativeMutationLock(
    options.paths,
    `create change ${options.name}`,
    () => createNativeChangeLocked(options)
  );
}
async function createNativeChangeLocked(options) {
  assertNativeName(options.name);
  const changeDir = nativeChangeDir(options.paths, options.name);
  await resolveContainedNativePath(options.paths.nativeRoot, changeDir);
  let createdChangeDir = false;
  try {
    try {
      await fs11.mkdir(changeDir, { recursive: false });
      createdChangeDir = true;
    } catch (error) {
      if (error.code === "ENOENT") {
        await fs11.mkdir(options.paths.changesDir, { recursive: true });
        try {
          await fs11.mkdir(changeDir, { recursive: false });
          createdChangeDir = true;
        } catch (retryError) {
          if (retryError.code === "EEXIST") {
            throw new Error(`Native change already exists: ${options.name}`, {
              cause: retryError
            });
          }
          throw retryError;
        }
      } else if (error.code === "EEXIST") {
        throw new Error(`Native change already exists: ${options.name}`, { cause: error });
      } else {
        throw error;
      }
    }
    const state = {
      schema: NATIVE_CHANGE_SCHEMA,
      minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
      revision: 1,
      name: options.name,
      language: options.language,
      phase: "shape",
      brief: "brief.md",
      approval: null,
      spec_changes: [],
      verification_result: "pending",
      verification_report: null,
      archived: false,
      created_at: (options.now ?? /* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      run_id: null
    };
    await Promise.all([
      fs11.mkdir(path14.join(changeDir, "specs"), { recursive: true }),
      fs11.mkdir(path14.join(changeDir, "runtime", "checkpoints"), { recursive: true }),
      atomicWriteText(path14.join(changeDir, "brief.md"), NATIVE_BRIEF_TEMPLATE)
    ]);
    const baseline = await createNativeContentSnapshot(options.paths, {
      now: options.now,
      origin: "change-created"
    });
    await writeNativeBaselineManifest(options.paths, state.name, baseline);
    await createNativeChangeFile(options.paths, state);
    return state;
  } catch (error) {
    if (createdChangeDir) await fs11.rm(changeDir, { recursive: true, force: true });
    throw error;
  }
}
async function readChangeDocumentFile(file) {
  const document = (0, import_yaml2.parseDocument)(await fs11.readFile(file, "utf8"), { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid Native change file ${file}: ${document.errors[0].message}`);
  }
  return document.toJS();
}
async function inspectNativeChange(paths, name) {
  const file = path14.join(nativeChangeDir(paths, name), "change.yaml");
  await resolveContainedNativePath(paths.nativeRoot, file);
  const inspection = inspectNativeChangeValue(await readChangeDocumentFile(file));
  if (inspection.state && inspection.state.name !== name) {
    throw new Error(`Native change directory/name mismatch: ${name}`);
  }
  if (await hasPendingNativeSchemaMigration(paths, name)) {
    return {
      status: "migration-required",
      schema: inspection.schema,
      minimumRuntimeVersion: inspection.minimumRuntimeVersion,
      state: inspection.state,
      message: `Native schema migration is incomplete for ${name}; run doctor --repair`
    };
  }
  return inspection;
}
async function readNativeChange(paths, name) {
  const inspection = await inspectNativeChange(paths, name);
  if (inspection.status === "migration-required") {
    throw new NativeSchemaMigrationRequiredError(name, inspection.schema);
  }
  if (inspection.status === "runtime-incompatible" || !inspection.state) {
    throw new NativeRuntimeCompatibilityError(inspection.schema, inspection.minimumRuntimeVersion);
  }
  return inspection.state;
}
async function createNativeChangeFile(paths, state) {
  const file = path14.join(nativeChangeDir(paths, state.name), "change.yaml");
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    await fs11.access(file);
    throw new Error(`Native change state already exists: ${state.name}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (state.revision !== 1) throw new Error("New Native change must start at revision 1");
  await atomicWriteText(file, (0, import_yaml2.stringify)(nativeChangeDocument(state)));
}
async function compareAndSwapNativeChangeFile(file, state, expectedRevision) {
  const next = {
    ...state,
    schema: NATIVE_CHANGE_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision: expectedRevision + 1
  };
  const result2 = await compareAndSwapNativeRevision({
    expectedRevision,
    next,
    read: async () => {
      const current = parseNativeChangeValue(await readChangeDocumentFile(file));
      if (current.name !== state.name) {
        throw new Error(`Native change file/name mismatch: ${state.name}`);
      }
      return current;
    },
    write: (value) => atomicWriteText(file, (0, import_yaml2.stringify)(nativeChangeDocument(value))),
    equals: (left, right) => JSON.stringify(nativeChangeDocument(left)) === JSON.stringify(nativeChangeDocument(right)),
    conflict: (actualRevision) => new NativeChangeRevisionConflictError(state.name, expectedRevision, actualRevision)
  });
  Object.assign(state, result2);
  return result2;
}
async function compareAndSwapNativeChangeLocked(paths, state, expectedRevision, options) {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  if (await hasPendingNativeSchemaMigration(paths, state.name)) {
    throw new NativeSchemaMigrationRequiredError(state.name, state.schema);
  }
  if (!options?.allowPendingCheckpointRecovery && await hasPendingNativeCheckpointRecovery(paths, state.name)) {
    throw new Error(
      `Native progress checkpoint recovery is required for ${state.name} before another state write`
    );
  }
  await assertNativeTrajectoryHealthy(paths, state.name);
  const file = path14.join(nativeChangeDir(paths, state.name), "change.yaml");
  await resolveContainedNativePath(paths.nativeRoot, file);
  return compareAndSwapNativeChangeFile(file, state, expectedRevision);
}
async function writeNativeChangeFile(file, state) {
  return compareAndSwapNativeChangeFile(file, state, state.revision);
}
async function readNativeChangeFile(file) {
  return parseNativeChangeValue(await readChangeDocumentFile(file));
}
async function listNativeChanges(paths) {
  let entries;
  try {
    entries = await fs11.readdir(paths.changesDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const names = entries.filter((entry2) => entry2.isDirectory() && !entry2.isSymbolicLink()).map((entry2) => entry2.name).sort();
  return Promise.all(names.map((name) => readNativeChange(paths, name)));
}

// domains/comet-native/native-artifacts.ts
var BRIEF_REQUIRED = ["Outcome", "Scope", "Non-goals", "Acceptance examples"];
var BRIEF_ALL = [
  ...BRIEF_REQUIRED,
  "Constraints and invariants",
  "Decisions",
  "Open questions",
  "Verification expectations"
];
var VERIFICATION_ALL = [
  "Acceptance evidence",
  "Commands and results",
  "Skipped checks",
  "Spec consistency",
  "Known limitations and risks",
  "Conclusion"
];
function markdownSections(source) {
  const sections = /* @__PURE__ */ new Map();
  let heading = null;
  let body = [];
  const flush = () => {
    if (heading !== null) sections.set(heading, body.join("\n").trim());
  };
  for (const line of source.split(/\r?\n/u)) {
    const match = /^# ([^#].*)$/u.exec(line);
    if (match) {
      flush();
      heading = match[1].trim();
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  flush();
  return sections;
}
async function readContainedFile(root, relativeRef) {
  const target = path15.resolve(root, ...relativeRef.split(/[\\/]/u));
  if (!isInsidePath(root, target))
    throw new Error(`Artifact escapes Native change: ${relativeRef}`);
  const realRoot = await fs12.realpath(root);
  const realTarget = await fs12.realpath(target);
  if (!isInsidePath(realRoot, realTarget)) {
    throw new Error(`Artifact symlink escapes Native change: ${relativeRef}`);
  }
  if (!(await fs12.stat(realTarget)).isFile())
    throw new Error(`Artifact is not a file: ${relativeRef}`);
  return realTarget;
}
function result(findings) {
  return { valid: findings.length === 0, findings };
}
async function validateNativeBrief(changeDir, briefRef) {
  const findings = [];
  let file;
  try {
    file = await readContainedFile(changeDir, briefRef);
  } catch (error) {
    return result([{ code: "brief-missing", message: error.message, path: briefRef }]);
  }
  const sections = markdownSections(await fs12.readFile(file, "utf8"));
  for (const heading of BRIEF_ALL) {
    if (!sections.has(heading)) {
      findings.push({
        code: "brief-section-missing",
        message: `Missing brief section: ${heading}`,
        path: briefRef
      });
    }
  }
  for (const heading of BRIEF_REQUIRED) {
    if ((sections.get(heading) ?? "").length === 0) {
      findings.push({
        code: "brief-section-empty",
        message: `Brief section is empty: ${heading}`,
        path: briefRef
      });
    }
  }
  const openQuestions = sections.get("Open questions") ?? "";
  if (/^\s*-\s*\[blocking\]/imu.test(openQuestions)) {
    findings.push({
      code: "brief-blocking-question",
      message: "Brief has a blocking open question",
      path: briefRef
    });
  }
  return result(findings);
}
async function validateNativeVerification(changeDir, reportRef) {
  const findings = [];
  let file;
  try {
    file = await readContainedFile(changeDir, reportRef);
  } catch (error) {
    return result([
      { code: "verification-missing", message: error.message, path: reportRef }
    ]);
  }
  const sections = markdownSections(await fs12.readFile(file, "utf8"));
  for (const heading of VERIFICATION_ALL) {
    if (!sections.has(heading)) {
      findings.push({
        code: "verification-section-missing",
        message: `Missing verification section: ${heading}`,
        path: reportRef
      });
    } else if ((sections.get(heading) ?? "").length === 0) {
      findings.push({
        code: "verification-section-empty",
        message: `Verification section is empty: ${heading}`,
        path: reportRef
      });
    }
  }
  return result(findings);
}
function canonicalSpecPath(paths, capability) {
  return path15.join(paths.specsDir, capability, "spec.md");
}
async function validateNativeSpecChanges(paths, state) {
  const findings = [];
  const changeDir = nativeChangeDir(paths, state.name);
  for (const change of state.spec_changes) {
    const canonical = canonicalSpecPath(paths, change.capability);
    let canonicalHash = null;
    try {
      await resolveContainedNativePath(paths.nativeRoot, canonical);
      canonicalHash = await sha256File(canonical);
    } catch (error) {
      if (error.code !== "ENOENT") {
        findings.push({
          code: "spec-canonical-unsafe",
          message: error.message,
          path: canonical
        });
        continue;
      }
    }
    if (change.operation === "create" && canonicalHash !== null) {
      findings.push({
        code: "spec-create-exists",
        message: `Canonical spec already exists: ${change.capability}`,
        path: canonical
      });
    }
    if (change.operation !== "create" && canonicalHash === null) {
      findings.push({
        code: "spec-base-missing",
        message: `Canonical spec is missing: ${change.capability}`,
        path: canonical
      });
    }
    if (change.operation !== "create" && canonicalHash !== null && canonicalHash !== change.base_hash) {
      findings.push({
        code: "spec-base-conflict",
        message: `Canonical spec changed for ${change.capability}: expected ${change.base_hash}, actual ${canonicalHash}`,
        path: canonical
      });
    }
    if (change.source) {
      try {
        await readContainedFile(changeDir, change.source);
      } catch (error) {
        findings.push({
          code: "spec-source-invalid",
          message: error.message,
          path: change.source
        });
      }
    }
  }
  return result(findings);
}
async function resolveNativeArtifactFile(changeDir, relativeRef) {
  return readContainedFile(changeDir, relativeRef);
}

// domains/comet-native/native-checkpoint-journal.ts
import { randomUUID as randomUUID6 } from "crypto";
import { promises as fs15 } from "fs";

// domains/comet-native/native-checkpoint-storage.ts
import { createHash as createHash5 } from "crypto";
import { promises as fs13 } from "fs";
import path16 from "path";

// domains/comet-native/native-redaction.ts
var AUTHORIZATION_PATTERN = /\b(Bearer|Basic)\s+[^\s"']+/giu;
var PRIVATE_KEY_PATTERN = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gu;
var URI_CREDENTIAL_PATTERN = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu;
var KNOWN_TOKEN_PATTERN = /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})\b/gu;
var JSON_CREDENTIAL_PATTERN = /("(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret(?:[_-]?access)?[_-]?key|private[_-]?key|token|password|passwd|secret|authorization|cookie|set[_-]?cookie)"\s*:\s*)"(?:\\[\s\S]|[^"\\\r\n])*"/giu;
var QUOTED_CREDENTIAL_PATTERN = /(["'])((?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret(?:[_-]?access)?[_-]?key|private[_-]?key|token|password|passwd|secret|authorization|cookie|set[_-]?cookie))\1(\s*:\s*)(["'])[^\r\n]*?\4/giu;
var CREDENTIAL_ASSIGNMENT_PATTERN = /\b((?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret(?:[_-]?access)?[_-]?key|private[_-]?key|token|password|passwd|secret|authorization|cookie|set[_-]?cookie))\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;"']+)/giu;
function redactNativeCredentialText(value) {
  return value.replace(AUTHORIZATION_PATTERN, "$1 [REDACTED]").replace(PRIVATE_KEY_PATTERN, "[REDACTED PRIVATE KEY]").replace(URI_CREDENTIAL_PATTERN, "$1[REDACTED]@").replace(KNOWN_TOKEN_PATTERN, "[REDACTED TOKEN]").replace(JSON_CREDENTIAL_PATTERN, '$1"[REDACTED]"').replace(QUOTED_CREDENTIAL_PATTERN, "$1$2$1$3$4[REDACTED]$4").replace(CREDENTIAL_ASSIGNMENT_PATTERN, "$1$2[REDACTED]");
}

// domains/comet-native/native-checkpoint-storage.ts
var NATIVE_CHECKPOINT_LIMITS = {
  maxArtifacts: 128,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxDocumentBytes: 256 * 1024
};
var HASH_PATTERN3 = /^[a-f0-9]{64}$/u;
function record5(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}
function exactKeys(value, keys, label) {
  const expected = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in value));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(", ")}`);
  if (missing.length > 0) throw new Error(`${label} is missing field(s): ${missing.join(", ")}`);
}
function stringValue(value, label, max = 2e3) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}
function positiveInteger3(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}
function nonNegativeInteger2(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}
function normalizeNativeCheckpointArtifactRef(value) {
  const trimmed = value.trim().replaceAll("\\", "/");
  if (trimmed.length === 0 || path16.isAbsolute(trimmed) || /^(?:[A-Za-z]:|~|\/)/u.test(trimmed) || trimmed.split("/").includes("..")) {
    throw new Error(`Checkpoint artifact must be project-relative: ${value}`);
  }
  const normalized = path16.posix.normalize(trimmed);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Checkpoint artifact must name a project file: ${value}`);
  }
  return normalized;
}
function nativeProgressCheckpointFile(paths, name) {
  return path16.join(nativeChangeDir(paths, name), "runtime", "checkpoints", "progress.json");
}
function nativeCheckpointJournalFile(paths, name) {
  return path16.join(nativeChangeDir(paths, name), "runtime", "checkpoint-journal.json");
}
function nativeCheckpointManifestFile(paths, name, hash) {
  if (!HASH_PATTERN3.test(hash)) throw new Error("Native checkpoint manifest hash is invalid");
  return path16.join(
    nativeChangeDir(paths, name),
    "runtime",
    "checkpoints",
    "manifests",
    `${hash}.json`
  );
}
function nativeCheckpointManifestRef(hash) {
  if (!HASH_PATTERN3.test(hash)) throw new Error("Native checkpoint manifest hash is invalid");
  return `runtime/checkpoints/manifests/${hash}.json`;
}
async function readBoundedJson(file, label) {
  const beforeLexical = await fs13.lstat(file);
  if (!beforeLexical.isFile() || beforeLexical.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  const beforeRealPath = await fs13.realpath(file);
  const handle = await fs13.open(file, "r");
  try {
    const [opened, pathBefore, openedRealPath] = await Promise.all([
      handle.stat(),
      fs13.lstat(file),
      fs13.realpath(file)
    ]);
    if (!opened.isFile() || !pathBefore.isFile() || pathBefore.isSymbolicLink() || openedRealPath !== beforeRealPath || !sameFileIdentity3(opened, pathBefore) || !sameFileIdentity3(opened, beforeLexical)) {
      throw new Error(`${label} changed while opening`);
    }
    const bytes = await readFileHandleBounded(
      handle,
      NATIVE_CHECKPOINT_LIMITS.maxDocumentBytes,
      label
    );
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat(),
      fs13.lstat(file),
      fs13.realpath(file)
    ]);
    if (!afterPath.isFile() || afterPath.isSymbolicLink() || afterRealPath !== beforeRealPath || !sameFileIdentity3(opened, afterHandle) || !sameFileIdentity3(opened, afterPath)) {
      throw new Error(`${label} changed while reading`);
    }
    return JSON.parse(bytes.toString("utf8"));
  } finally {
    await handle.close();
  }
}
function parseArtifact(value, index) {
  const artifact = record5(value, `checkpoint manifest artifact ${index}`);
  exactKeys(artifact, ["path", "hash", "size"], `checkpoint manifest artifact ${index}`);
  const artifactPath = normalizeNativeCheckpointArtifactRef(
    stringValue(artifact.path, `checkpoint artifact ${index} path`, 4096)
  );
  const sensitiveReason = nativeSensitiveRelativePathReason(artifactPath);
  if (sensitiveReason) {
    throw new Error(
      `checkpoint artifact ${index} is excluded as sensitive (${sensitiveReason}): ${artifactPath}`
    );
  }
  if (typeof artifact.hash !== "string" || !HASH_PATTERN3.test(artifact.hash)) {
    throw new Error(`checkpoint artifact ${index} hash is invalid`);
  }
  return {
    path: artifactPath,
    hash: artifact.hash,
    size: nonNegativeInteger2(artifact.size, `checkpoint artifact ${index} size`)
  };
}
function parseNativeCheckpointManifestValue(value, expectedName) {
  const manifest = record5(value, "Native checkpoint manifest");
  exactKeys(
    manifest,
    ["schema", "change", "artifacts", "totalBytes"],
    "Native checkpoint manifest"
  );
  if (manifest.schema !== "comet.native.checkpoint-manifest.v1") {
    throw new Error("Native checkpoint manifest schema is invalid");
  }
  if (manifest.change !== expectedName)
    throw new Error("Native checkpoint manifest change mismatch");
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error("Native checkpoint manifest artifacts must be an array");
  }
  if (manifest.artifacts.length > NATIVE_CHECKPOINT_LIMITS.maxArtifacts) {
    throw new Error("Native checkpoint manifest has too many artifacts");
  }
  const artifacts = manifest.artifacts.map(parseArtifact);
  const sorted = [...artifacts].sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(artifacts) !== JSON.stringify(sorted)) {
    throw new Error("Native checkpoint manifest artifacts must be sorted");
  }
  if (new Set(artifacts.map((artifact) => artifact.path)).size !== artifacts.length) {
    throw new Error("Native checkpoint manifest has duplicate artifacts");
  }
  const totalBytes = nonNegativeInteger2(manifest.totalBytes, "checkpoint manifest totalBytes");
  if (artifacts.reduce((total, artifact) => total + artifact.size, 0) !== totalBytes) {
    throw new Error("Native checkpoint manifest totalBytes mismatch");
  }
  if (totalBytes > NATIVE_CHECKPOINT_LIMITS.maxTotalBytes) {
    throw new Error("Native checkpoint manifest totalBytes exceeds its budget");
  }
  return {
    schema: "comet.native.checkpoint-manifest.v1",
    change: expectedName,
    artifacts,
    totalBytes
  };
}
function hashNativeCheckpointManifest(manifest) {
  return sha256Text(JSON.stringify(parseNativeCheckpointManifestValue(manifest, manifest.change)));
}
function parseNativeProgressCheckpointValue(value, expectedName) {
  const checkpoint = record5(value, "Native progress checkpoint");
  exactKeys(
    checkpoint,
    [
      "schema",
      "id",
      "change",
      "phase",
      "previousRevision",
      "stateRevision",
      "summary",
      "nextAction",
      "inputHash",
      "manifestHash",
      "manifestRef",
      "artifactCount",
      "createdAt"
    ],
    "Native progress checkpoint"
  );
  if (checkpoint.schema !== "comet.native.progress-checkpoint.v1") {
    throw new Error("Native progress checkpoint schema is invalid");
  }
  if (checkpoint.change !== expectedName) throw new Error("Native checkpoint change mismatch");
  const phase = checkpoint.phase;
  if (phase !== "shape" && phase !== "build" && phase !== "verify" && phase !== "archive") {
    throw new Error("Native checkpoint phase is invalid");
  }
  const previousRevision = positiveInteger3(
    checkpoint.previousRevision,
    "Native checkpoint previousRevision"
  );
  const stateRevision = positiveInteger3(
    checkpoint.stateRevision,
    "Native checkpoint stateRevision"
  );
  if (stateRevision !== previousRevision + 1) {
    throw new Error("Native checkpoint stateRevision must increment previousRevision once");
  }
  const manifestHash = stringValue(checkpoint.manifestHash, "Native checkpoint manifestHash", 64);
  if (!HASH_PATTERN3.test(manifestHash))
    throw new Error("Native checkpoint manifestHash is invalid");
  const expectedManifestRef = nativeCheckpointManifestRef(manifestHash);
  if (checkpoint.manifestRef !== expectedManifestRef) {
    throw new Error("Native checkpoint manifestRef does not match manifestHash");
  }
  const inputHash = stringValue(checkpoint.inputHash, "Native checkpoint inputHash", 64);
  if (!HASH_PATTERN3.test(inputHash)) throw new Error("Native checkpoint inputHash is invalid");
  const createdAt = stringValue(checkpoint.createdAt, "Native checkpoint createdAt", 64);
  if (Number.isNaN(Date.parse(createdAt)))
    throw new Error("Native checkpoint createdAt is invalid");
  const artifactCount = nonNegativeInteger2(
    checkpoint.artifactCount,
    "Native checkpoint artifactCount"
  );
  if (artifactCount > NATIVE_CHECKPOINT_LIMITS.maxArtifacts) {
    throw new Error("Native checkpoint artifactCount exceeds its budget");
  }
  const summary = stringValue(checkpoint.summary, "Native checkpoint summary");
  const nextAction = stringValue(checkpoint.nextAction, "Native checkpoint nextAction");
  if (redactNativeCredentialText(summary) !== summary || redactNativeCredentialText(nextAction) !== nextAction) {
    throw new Error("Native checkpoint text contains unredacted credential material");
  }
  return {
    schema: "comet.native.progress-checkpoint.v1",
    id: stringValue(checkpoint.id, "Native checkpoint id", 128),
    change: expectedName,
    phase,
    previousRevision,
    stateRevision,
    summary,
    nextAction,
    inputHash,
    manifestHash,
    manifestRef: expectedManifestRef,
    artifactCount,
    createdAt
  };
}
function parseNativeCheckpointJournalValue(value, expectedName) {
  const journal = record5(value, "Native checkpoint journal");
  exactKeys(
    journal,
    [
      "schema",
      "id",
      "change",
      "inputHash",
      "createdAt",
      "previousState",
      "nextState",
      "checkpoint",
      "manifest"
    ],
    "Native checkpoint journal"
  );
  if (journal.schema !== "comet.native.checkpoint-journal.v1") {
    throw new Error("Native checkpoint journal schema is invalid");
  }
  if (journal.change !== expectedName) throw new Error("Native checkpoint journal change mismatch");
  const previousState = parseNativeChangeValue(journal.previousState);
  const nextState = parseNativeChangeValue(journal.nextState);
  const checkpoint = parseNativeProgressCheckpointValue(journal.checkpoint, expectedName);
  const manifest = parseNativeCheckpointManifestValue(journal.manifest, expectedName);
  const inputHash = stringValue(journal.inputHash, "Native checkpoint journal inputHash", 64);
  const expectedInputHash = sha256Text(
    JSON.stringify({
      summary: checkpoint.summary,
      nextAction: checkpoint.nextAction,
      artifacts: manifest.artifacts
    })
  );
  if (!HASH_PATTERN3.test(inputHash) || inputHash !== checkpoint.inputHash || inputHash !== expectedInputHash || journal.id !== checkpoint.id || journal.createdAt !== checkpoint.createdAt) {
    throw new Error("Native checkpoint journal envelope mismatch");
  }
  if (previousState.name !== expectedName || nextState.name !== expectedName || nextState.revision !== previousState.revision + 1 || checkpoint.previousRevision !== previousState.revision || checkpoint.stateRevision !== nextState.revision || checkpoint.phase !== nextState.phase || checkpoint.manifestHash !== hashNativeCheckpointManifest(manifest) || checkpoint.artifactCount !== manifest.artifacts.length) {
    throw new Error("Native checkpoint journal state mismatch");
  }
  return {
    schema: "comet.native.checkpoint-journal.v1",
    id: checkpoint.id,
    change: expectedName,
    inputHash,
    createdAt: checkpoint.createdAt,
    previousState,
    nextState,
    checkpoint,
    manifest
  };
}
function sameFileIdentity3(left, right) {
  const objectIdentity = left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0 ? left.dev === right.dev && left.ino === right.ino : left.birthtimeMs === right.birthtimeMs && left.ctimeMs === right.ctimeMs;
  return objectIdentity && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
async function readFileHandleBounded(handle, maxBytes, label) {
  const chunks = [];
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
  let total = 0;
  while (true) {
    const read = await handle.read(buffer, 0, Math.min(buffer.length, maxBytes + 1 - total), null);
    if (read.bytesRead === 0) return Buffer.concat(chunks, total);
    total += read.bytesRead;
    if (total > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
    chunks.push(Buffer.from(buffer.subarray(0, read.bytesRead)));
  }
}
async function hashProjectArtifact(paths, artifactRef, hooks) {
  const target = path16.resolve(paths.projectRoot, ...artifactRef.split("/"));
  if (!isInsidePath(paths.projectRoot, target) || isInsidePath(paths.nativeRoot, target)) {
    throw new Error(`Checkpoint artifact is outside project content: ${artifactRef}`);
  }
  const sensitiveReason = nativeSensitiveArtifactReason(paths, artifactRef);
  if (sensitiveReason) {
    throw new Error(
      `Checkpoint artifact is excluded as sensitive (${sensitiveReason}): ${artifactRef}`
    );
  }
  const lexical = await fs13.lstat(target);
  if (!lexical.isFile() || lexical.isSymbolicLink()) {
    throw new Error(`Checkpoint artifact must be a regular file: ${artifactRef}`);
  }
  const [realProjectRoot, realNativeRoot, realTarget] = await Promise.all([
    fs13.realpath(paths.projectRoot),
    fs13.realpath(paths.nativeRoot),
    fs13.realpath(target)
  ]);
  if (!isInsidePath(realProjectRoot, realTarget) || isInsidePath(realNativeRoot, realTarget)) {
    throw new Error(`Checkpoint artifact resolves outside project content: ${artifactRef}`);
  }
  const handle = await fs13.open(target, "r");
  try {
    const opened = await handle.stat();
    await hooks?.afterOpen?.(artifactRef);
    const [pathBefore, openedRealTarget, lexicalBefore] = await Promise.all([
      fs13.stat(target),
      fs13.realpath(target),
      fs13.lstat(target)
    ]);
    if (!opened.isFile() || !lexicalBefore.isFile() || lexicalBefore.isSymbolicLink() || openedRealTarget !== realTarget || !sameFileIdentity3(opened, pathBefore) || !sameFileIdentity3(opened, lexical)) {
      throw new Error(`Checkpoint artifact changed while opening: ${artifactRef}`);
    }
    if (opened.size > NATIVE_CHECKPOINT_LIMITS.maxFileBytes) {
      throw new Error(`Checkpoint artifact exceeds file budget: ${artifactRef}`);
    }
    await hooks?.beforeRead?.(artifactRef);
    const content = await readFileHandleBounded(
      handle,
      NATIVE_CHECKPOINT_LIMITS.maxFileBytes,
      `Checkpoint artifact ${artifactRef}`
    );
    const [afterHandle, afterPath, afterRealTarget, afterLexical] = await Promise.all([
      handle.stat(),
      fs13.stat(target),
      fs13.realpath(target),
      fs13.lstat(target)
    ]);
    if (!afterLexical.isFile() || afterLexical.isSymbolicLink() || afterRealTarget !== realTarget || !sameFileIdentity3(opened, afterHandle) || !sameFileIdentity3(opened, afterPath)) {
      throw new Error(`Checkpoint artifact changed while reading: ${artifactRef}`);
    }
    return {
      path: artifactRef,
      hash: createHash5("sha256").update(content).digest("hex"),
      size: content.length
    };
  } finally {
    await handle.close();
  }
}
async function createNativeCheckpointManifest(paths, name, artifactRefs, hooks) {
  const normalized = artifactRefs.map(normalizeNativeCheckpointArtifactRef).sort();
  if (normalized.length > NATIVE_CHECKPOINT_LIMITS.maxArtifacts) {
    throw new Error(
      `Checkpoint supports at most ${NATIVE_CHECKPOINT_LIMITS.maxArtifacts} artifacts`
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Checkpoint artifacts must not contain duplicates");
  }
  const artifacts = [];
  let totalBytes = 0;
  for (const artifactRef of normalized) {
    const artifact = await hashProjectArtifact(paths, artifactRef, hooks);
    totalBytes += artifact.size;
    if (totalBytes > NATIVE_CHECKPOINT_LIMITS.maxTotalBytes) {
      throw new Error("Checkpoint artifacts exceed the total byte budget");
    }
    artifacts.push(artifact);
  }
  return {
    schema: "comet.native.checkpoint-manifest.v1",
    change: name,
    artifacts,
    totalBytes
  };
}
async function readNativeProgressCheckpoint(paths, name) {
  const file = nativeProgressCheckpointFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    return parseNativeProgressCheckpointValue(
      await readBoundedJson(file, "Native progress checkpoint"),
      name
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function readNativeCheckpointManifest(paths, name, hash) {
  const file = nativeCheckpointManifestFile(paths, name, hash);
  await resolveContainedNativePath(paths.nativeRoot, file);
  const value = await readBoundedJson(file, "Native checkpoint manifest");
  const manifest = parseNativeCheckpointManifestValue(value, name);
  assertCheckpointManifestSafeForPaths(paths, manifest);
  if (hashNativeCheckpointManifest(manifest) !== hash) {
    throw new Error("Native checkpoint manifest content hash mismatch");
  }
  return manifest;
}
async function readNativeCheckpointJournal(paths, name) {
  const file = nativeCheckpointJournalFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    const journal = parseNativeCheckpointJournalValue(
      await readBoundedJson(file, "Native checkpoint journal"),
      name
    );
    assertCheckpointManifestSafeForPaths(paths, journal.manifest);
    return journal;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function writeNativeCheckpointManifest(paths, name, manifest, hooks) {
  const parsed = parseNativeCheckpointManifestValue(manifest, name);
  assertCheckpointManifestSafeForPaths(paths, parsed);
  const hash = hashNativeCheckpointManifest(parsed);
  const file = nativeCheckpointManifestFile(paths, name, hash);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    const existing = await readNativeCheckpointManifest(paths, name, hash);
    if (JSON.stringify(existing) !== JSON.stringify(parsed)) {
      throw new Error("Native checkpoint manifest hash collision");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await atomicWriteJson(file, parsed, {
    containedRoot: paths.nativeRoot,
    beforeCommit: hooks?.beforeCommit
  });
  return hash;
}
function assertCheckpointManifestSafeForPaths(paths, manifest) {
  for (const artifact of manifest.artifacts) {
    const reason = nativeSensitiveArtifactReason(paths, artifact.path);
    if (reason) {
      throw new Error(
        `Native checkpoint manifest contains a sensitive artifact (${reason}): ${artifact.path}`
      );
    }
  }
}
async function writeNativeProgressCheckpoint(paths, checkpoint) {
  const parsed = parseNativeProgressCheckpointValue(checkpoint, checkpoint.change);
  const manifest = await readNativeCheckpointManifest(paths, parsed.change, parsed.manifestHash);
  const expectedInputHash = sha256Text(
    JSON.stringify({
      summary: parsed.summary,
      nextAction: parsed.nextAction,
      artifacts: manifest.artifacts
    })
  );
  if (parsed.inputHash !== expectedInputHash || parsed.artifactCount !== manifest.artifacts.length) {
    throw new Error("Native progress checkpoint does not match its artifact manifest");
  }
  const file = nativeProgressCheckpointFile(paths, checkpoint.change);
  await resolveContainedNativePath(paths.nativeRoot, file);
  await atomicWriteJson(file, parsed, { containedRoot: paths.nativeRoot });
}
async function writeNativeCheckpointJournal(paths, journal) {
  const parsed = parseNativeCheckpointJournalValue(journal, journal.change);
  const file = nativeCheckpointJournalFile(paths, journal.change);
  await resolveContainedNativePath(paths.nativeRoot, file);
  if (await readNativeCheckpointJournal(paths, journal.change)) {
    throw new Error(`Native checkpoint recovery is already pending for ${journal.change}`);
  }
  await atomicWriteJson(file, parsed, { containedRoot: paths.nativeRoot });
}
async function inspectNativeCheckpointFreshness(options) {
  let checkpoint;
  try {
    checkpoint = await readNativeProgressCheckpoint(options.paths, options.name);
  } catch (error) {
    return {
      checkpoint: null,
      manifest: null,
      freshness: "stale",
      reasons: ["checkpoint-progress-invalid"],
      findings: [
        {
          code: "checkpoint-progress-invalid",
          message: `Native progress checkpoint is invalid: ${error.message}. Automatic repair is unavailable; inspect and move the invalid checkpoint file aside before retrying`,
          path: nativeProgressCheckpointFile(options.paths, options.name)
        }
      ]
    };
  }
  if (!checkpoint) {
    return {
      checkpoint: null,
      manifest: null,
      freshness: "fresh",
      reasons: ["no-checkpoint"],
      findings: []
    };
  }
  const reasons = [];
  const findings = [];
  if (checkpoint.stateRevision !== options.stateRevision) reasons.push("state-revision-changed");
  let manifest = null;
  try {
    manifest = await readNativeCheckpointManifest(
      options.paths,
      options.name,
      checkpoint.manifestHash
    );
    const expectedInputHash = sha256Text(
      JSON.stringify({
        summary: checkpoint.summary,
        nextAction: checkpoint.nextAction,
        artifacts: manifest.artifacts
      })
    );
    if (checkpoint.inputHash !== expectedInputHash || checkpoint.artifactCount !== manifest.artifacts.length) {
      throw new Error("Native progress checkpoint does not match its artifact manifest");
    }
    for (const expected of manifest.artifacts) {
      try {
        const actual = await hashProjectArtifact(options.paths, expected.path);
        if (actual.hash !== expected.hash || actual.size !== expected.size) {
          reasons.push(`artifact-changed:${expected.path}`);
        }
      } catch {
        reasons.push(`artifact-unavailable:${expected.path}`);
      }
    }
  } catch (error) {
    reasons.push("checkpoint-manifest-invalid");
    findings.push({
      code: "checkpoint-manifest-invalid",
      message: `Native checkpoint manifest is invalid: ${error.message}`,
      path: nativeCheckpointManifestFile(options.paths, options.name, checkpoint.manifestHash)
    });
  }
  return {
    checkpoint,
    manifest,
    freshness: reasons.length === 0 ? "fresh" : "stale",
    reasons,
    findings
  };
}

// domains/comet-native/native-transition-journal.ts
import { randomUUID as randomUUID5 } from "crypto";
import { promises as fs14 } from "fs";
import path17 from "path";

// domains/comet-native/native-trajectory.ts
async function appendNativeTrajectoryEvent(options) {
  const trajectory = await readTrajectory(options.changeDir, options.run.trajectoryRef);
  const event = {
    sequence: trajectory.length + 1,
    timestamp: (options.now ?? /* @__PURE__ */ new Date()).toISOString(),
    type: options.type,
    runId: options.run.runId,
    data: options.data
  };
  await appendTrajectory(options.changeDir, options.run.trajectoryRef, event);
  return event;
}
async function writeNativeCheckpoint(options) {
  const checkpoint = {
    runId: options.run.runId,
    stateVersion: options.run.iteration,
    trajectoryOffset: options.trajectoryOffset,
    contextHash: null,
    artifactsHash: sha256Text(options.evidenceHash),
    createdAt: (options.now ?? /* @__PURE__ */ new Date()).toISOString()
  };
  await writeCheckpoint(options.changeDir, options.run.checkpointRef, checkpoint);
  return checkpoint;
}

// domains/comet-native/native-transition-journal.ts
var COMMON_JOURNAL_KEYS = [
  "schema",
  "id",
  "change",
  "evidenceHash",
  "createdAt",
  "previousState",
  "nextState",
  "previousRun",
  "nextRun",
  "eventData"
];
var LEGACY_JOURNAL_KEYS = new Set(COMMON_JOURNAL_KEYS);
var CURRENT_JOURNAL_KEYS = /* @__PURE__ */ new Set([
  ...COMMON_JOURNAL_KEYS,
  "minimum_runtime_version",
  "revision"
]);
var NativeTransitionMigrationRequiredError = class extends Error {
  constructor(change) {
    super(`Native transition for ${change} requires doctor migration before recovery`);
    this.change = change;
    this.name = "NativeTransitionMigrationRequiredError";
  }
  change;
  code = "native-transition-migration-required";
};
function nativeTransitionJournalFile(paths, name) {
  return path17.join(nativeChangeDir(paths, name), "runtime", "transition.json");
}
function nativeTransitionLockName(name) {
  return `transition-${name}`;
}
async function acquireNativeTransitionLock(paths, name, operation) {
  const lockName2 = nativeTransitionLockName(name);
  try {
    return await acquireNativeLock(paths, lockName2, operation);
  } catch (error) {
    const file = path17.join(paths.locksDir, `${lockName2}.lock`);
    const diagnosis = await diagnoseNativeLock(file);
    if (diagnosis.status !== "stale") throw error;
    await fs14.rm(file, { force: true });
    return acquireNativeLock(paths, lockName2, operation);
  }
}
async function withNativeTransitionLock(paths, name, operation, work) {
  const lock = await acquireNativeTransitionLock(paths, name, operation);
  try {
    return await work();
  } finally {
    await releaseNativeLock(lock);
  }
}
function journalRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Native transition journal must be an object");
  }
  return value;
}
function rejectUnknownJournalFields(journal, known) {
  const unknown = Object.keys(journal).find((key) => !known.has(key));
  if (unknown) throw new Error(`Native transition journal contains unknown field: ${unknown}`);
}
function positiveInteger4(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}
function validateJournalEnvelope(journal, expectedName) {
  if (journal.change !== expectedName) throw new Error("Native transition journal change mismatch");
  if (typeof journal.id !== "string" || journal.id.length === 0) {
    throw new Error("Native transition journal id is invalid");
  }
  if (typeof journal.evidenceHash !== "string" || !/^[a-f0-9]{64}$/u.test(journal.evidenceHash)) {
    throw new Error("Native transition journal evidence hash is invalid");
  }
  if (typeof journal.createdAt !== "string" || Number.isNaN(Date.parse(journal.createdAt))) {
    throw new Error("Native transition journal timestamp is invalid");
  }
  if (!journal.nextRun || typeof journal.nextRun !== "object") {
    throw new Error("Native transition journal next Run is invalid");
  }
  if (!journal.eventData || typeof journal.eventData !== "object" || Array.isArray(journal.eventData)) {
    throw new Error("Native transition journal event data is invalid");
  }
  if (journal.previousRun !== null && (typeof journal.previousRun !== "object" || Array.isArray(journal.previousRun))) {
    throw new Error("Native transition journal previous Run is invalid");
  }
  return {
    id: journal.id,
    evidenceHash: journal.evidenceHash,
    createdAt: journal.createdAt,
    previousRun: journal.previousRun ?? null,
    nextRun: journal.nextRun,
    eventData: journal.eventData
  };
}
function parseNativeTransitionJournalValue(value, expectedName) {
  const journal = journalRecord(value);
  rejectUnknownJournalFields(journal, CURRENT_JOURNAL_KEYS);
  if (journal.schema !== NATIVE_TRANSITION_SCHEMA) {
    throw new Error(`Expected Native transition schema ${NATIVE_TRANSITION_SCHEMA}`);
  }
  const minimumRuntimeVersion = positiveInteger4(
    journal.minimum_runtime_version,
    "Native transition minimum_runtime_version"
  );
  if (minimumRuntimeVersion > NATIVE_RUNTIME_PROTOCOL_VERSION) {
    throw new Error(
      `Native transition requires runtime protocol ${minimumRuntimeVersion}; current protocol is ${NATIVE_RUNTIME_PROTOCOL_VERSION}`
    );
  }
  if (minimumRuntimeVersion !== NATIVE_RUNTIME_PROTOCOL_VERSION) {
    throw new Error(
      `Native transition ${NATIVE_TRANSITION_SCHEMA} minimum_runtime_version must be ${NATIVE_RUNTIME_PROTOCOL_VERSION}`
    );
  }
  const revision = positiveInteger4(journal.revision, "Native transition revision");
  if (revision !== 1) throw new Error("Native transition journal revision must be 1");
  const envelope = validateJournalEnvelope(journal, expectedName);
  const previousState = parseNativeChangeValue(journal.previousState);
  const nextState = parseNativeChangeValue(journal.nextState);
  if (previousState.name !== expectedName || nextState.name !== expectedName) {
    throw new Error("Native transition journal state mismatch");
  }
  if (envelope.nextRun.runId !== nextState.run_id || envelope.nextRun.currentStep !== nextState.phase || nextState.revision !== previousState.revision + 1) {
    throw new Error("Native transition journal Run/state mismatch");
  }
  return {
    schema: NATIVE_TRANSITION_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision,
    id: envelope.id,
    change: expectedName,
    evidenceHash: envelope.evidenceHash,
    createdAt: envelope.createdAt,
    previousState,
    nextState,
    previousRun: envelope.previousRun,
    nextRun: envelope.nextRun,
    eventData: envelope.eventData
  };
}
function parseLegacyNativeTransitionJournalValue(value, expectedName) {
  const journal = journalRecord(value);
  rejectUnknownJournalFields(journal, LEGACY_JOURNAL_KEYS);
  if (journal.schema !== NATIVE_LEGACY_TRANSITION_SCHEMA) {
    throw new Error(`Expected Native transition schema ${NATIVE_LEGACY_TRANSITION_SCHEMA}`);
  }
  const envelope = validateJournalEnvelope(journal, expectedName);
  const previousState = parseLegacyNativeChangeValue(journal.previousState);
  const nextState = parseLegacyNativeChangeValue(journal.nextState);
  if (previousState.name !== expectedName || nextState.name !== expectedName) {
    throw new Error("Native transition journal state mismatch");
  }
  if (envelope.nextRun.runId !== nextState.run_id || envelope.nextRun.currentStep !== nextState.phase) {
    throw new Error("Native transition journal Run/state mismatch");
  }
  return {
    schema: NATIVE_LEGACY_TRANSITION_SCHEMA,
    id: envelope.id,
    change: expectedName,
    evidenceHash: envelope.evidenceHash,
    createdAt: envelope.createdAt,
    previousState,
    nextState,
    previousRun: envelope.previousRun,
    nextRun: envelope.nextRun,
    eventData: envelope.eventData
  };
}
function inspectNativeTransitionJournalValue(value, expectedName) {
  const journal = journalRecord(value);
  if (journal.schema === NATIVE_TRANSITION_SCHEMA) {
    return { status: "current", journal: parseNativeTransitionJournalValue(journal, expectedName) };
  }
  if (journal.schema === NATIVE_LEGACY_TRANSITION_SCHEMA) {
    return {
      status: "migration-required",
      journal: parseLegacyNativeTransitionJournalValue(journal, expectedName)
    };
  }
  throw new Error(`Unsupported Native transition journal schema: ${String(journal.schema)}`);
}
async function inspectPendingNativeTransitionSchema(paths, name) {
  const file = nativeTransitionJournalFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    return inspectNativeTransitionJournalValue(JSON.parse(await fs14.readFile(file, "utf8")), name);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function inspectPendingNativeTransition(paths, name) {
  const inspection = await inspectPendingNativeTransitionSchema(paths, name);
  if (!inspection) return null;
  if (inspection.status === "migration-required") {
    throw new NativeTransitionMigrationRequiredError(name);
  }
  return inspection.journal;
}
async function prepareNativeTransition(options) {
  if (await hasPendingNativeSchemaMigration(options.paths, options.nextState.name)) {
    throw new Error(
      `Native schema migration is incomplete for ${options.nextState.name}; run doctor --repair`
    );
  }
  await assertNativeTrajectoryHealthy(options.paths, options.nextState.name);
  const journal = {
    schema: NATIVE_TRANSITION_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision: 1,
    id: options.transitionId?.() ?? randomUUID5(),
    change: options.nextState.name,
    evidenceHash: options.evidenceHash,
    createdAt: (options.now ?? /* @__PURE__ */ new Date()).toISOString(),
    previousState: options.previousState,
    nextState: options.nextState,
    previousRun: options.previousRun,
    nextRun: options.nextRun,
    eventData: options.eventData
  };
  const file = nativeTransitionJournalFile(options.paths, journal.change);
  await resolveContainedNativePath(options.paths.nativeRoot, file);
  if (await inspectPendingNativeTransition(options.paths, journal.change)) {
    throw new Error(`Native transition recovery is already pending for ${journal.change}`);
  }
  await atomicWriteJson(file, journal);
  return journal;
}
async function continueNativeTransitionLocked(paths, name, hooks) {
  if (await hasPendingNativeSchemaMigration(paths, name)) {
    throw new Error(`Native schema migration is incomplete for ${name}; run doctor --repair`);
  }
  await assertNativeTrajectoryHealthy(paths, name);
  const journal = await inspectPendingNativeTransition(paths, name);
  if (!journal) return null;
  const changeDir = nativeChangeDir(paths, name);
  await writeRunStateAt(changeDir, journal.nextRun, NATIVE_RUN_STORAGE);
  await hooks?.afterRunStateWritten?.(journal);
  await compareAndSwapNativeChangeLocked(paths, journal.nextState, journal.previousState.revision);
  await hooks?.afterChangeStateWritten?.(journal);
  let trajectory = await readTrajectory(changeDir, journal.nextRun.trajectoryRef);
  if (journal.previousRun === null) {
    let started = trajectory.find(
      (item) => item.type === "run_started" && item.data.transitionId === journal.id
    );
    if (!started) {
      started = await appendNativeTrajectoryEvent({
        changeDir,
        run: journal.nextRun,
        type: "run_started",
        data: {
          runtime: "comet-native",
          phase: journal.previousState.phase,
          transitionId: journal.id
        },
        now: new Date(journal.createdAt)
      });
      trajectory = [...trajectory, started];
    }
  }
  let event = trajectory.find(
    (item) => item.type === "state_transitioned" && item.data.transitionId === journal.id
  );
  if (!event) {
    event = await appendNativeTrajectoryEvent({
      changeDir,
      run: journal.nextRun,
      type: "state_transitioned",
      data: { ...journal.eventData, transitionId: journal.id },
      now: new Date(journal.createdAt)
    });
  }
  await writeNativeCheckpoint({
    changeDir,
    run: journal.nextRun,
    trajectoryOffset: event.sequence,
    evidenceHash: journal.evidenceHash,
    now: new Date(journal.createdAt)
  });
  await fs14.rm(nativeTransitionJournalFile(paths, name), { force: true });
  return journal.nextState;
}
async function continueNativeTransition(paths, name, hooks) {
  return withNativeMutationLock(
    paths,
    `continue transition ${name}`,
    () => withNativeTransitionLock(
      paths,
      name,
      `continue transition ${name}`,
      () => continueNativeTransitionLocked(paths, name, hooks)
    )
  );
}

// domains/comet-native/native-checkpoint-journal.ts
async function prepareNativeCheckpointJournal(options) {
  const createdAt = (options.now ?? /* @__PURE__ */ new Date()).toISOString();
  const id = options.checkpointId?.() ?? randomUUID6();
  const checkpoint = {
    ...options.checkpoint,
    id,
    createdAt
  };
  const journal = {
    schema: "comet.native.checkpoint-journal.v1",
    id,
    change: options.previousState.name,
    inputHash: checkpoint.inputHash,
    createdAt,
    previousState: options.previousState,
    nextState: options.nextState,
    checkpoint,
    manifest: options.manifest
  };
  await writeNativeCheckpointManifest(options.paths, options.previousState.name, options.manifest);
  await writeNativeCheckpointJournal(options.paths, journal);
  return journal;
}
async function continueNativeCheckpointLocked(paths, name, hooks) {
  const journal = await readNativeCheckpointJournal(paths, name);
  if (!journal) return null;
  const manifestHash = await writeNativeCheckpointManifest(paths, journal.change, journal.manifest);
  if (manifestHash !== journal.checkpoint.manifestHash) {
    throw new Error("Native checkpoint recovery manifest hash mismatch");
  }
  await compareAndSwapNativeChangeLocked(paths, journal.nextState, journal.previousState.revision, {
    allowPendingCheckpointRecovery: true
  });
  await hooks?.afterStateWritten?.(journal);
  await writeNativeProgressCheckpoint(paths, journal.checkpoint);
  await hooks?.afterProgressWritten?.(journal);
  await fs15.rm(nativeCheckpointJournalFile(paths, name), { force: true });
  return journal;
}
async function continueNativeCheckpoint(paths, name, hooks) {
  return withNativeMutationLock(
    paths,
    `continue checkpoint ${name}`,
    () => withNativeTransitionLock(paths, name, `continue checkpoint ${name}`, async () => {
      await continueNativeTransitionLocked(paths, name);
      return continueNativeCheckpointLocked(paths, name, hooks);
    })
  );
}

// domains/comet-native/native-change-recovery.ts
async function settleNativeChangeJournalsLocked(paths, name) {
  await continueNativeTransitionLocked(paths, name);
  await continueNativeCheckpointLocked(paths, name);
}

// domains/comet-native/native-runtime-package.ts
var NATIVE_RUNTIME_PACKAGE = {
  root: "/comet/native-runtime",
  packageKind: "runtime",
  definition: {
    apiVersion: "comet/v1alpha1",
    kind: "Skill",
    metadata: {
      name: "comet-native-runtime",
      version: "1",
      description: "Comet-owned state runtime for the Native workflow."
    },
    goal: {
      statement: "Advance a Native change only after its current guard passes.",
      inputs: [],
      outputs: [],
      success: ["The Native change and Run state agree on the next phase."]
    },
    orchestration: {
      mode: "deterministic",
      entry: "shape",
      steps: [
        { id: "shape", action: { type: "checkpoint" }, next: "build" },
        { id: "build", action: { type: "checkpoint" }, next: "verify" },
        { id: "verify", action: { type: "checkpoint" }, next: "archive" },
        { id: "archive", action: { type: "checkpoint" } }
      ]
    },
    skills: [],
    agents: [],
    tools: []
  },
  guardrails: {
    allowedSkills: [],
    allowedAgents: [],
    allowedTools: [],
    maxIterations: 16,
    maxRetriesPerAction: 2,
    confirmationRequiredFor: []
  },
  evals: []
};
var NATIVE_RUNTIME_HASH = sha256Text("comet-native-runtime:v1");
var nativePhaseResolver = {
  resolveStep({ pkg, state }) {
    return pkg.definition.orchestration.steps?.find((step) => step.id === state.currentStep);
  },
  resolveNext({ step, outcome }) {
    if (step.id === "verify" && outcome.state?.verification_result === "fail") return "build";
    return step.next ?? null;
  }
};

// domains/comet-native/native-selection.ts
import { promises as fs16 } from "fs";
import path18 from "path";
function nativeSelectionFile(paths) {
  return path18.join(paths.runtimeDir, "current-change.json");
}
async function selectNativeChange(paths, name) {
  return withNativeMutationLock(paths, `select change ${name}`, async () => {
    assertNativeName(name);
    await readNativeChange(paths, name);
    const selection = { schema: "comet.native.selection.v1", change: name };
    const file = await resolveContainedNativePath(paths.nativeRoot, nativeSelectionFile(paths));
    await atomicWriteJson(file, selection);
  });
}
async function clearNativeSelectionLocked(paths) {
  await assertNoPendingNativeRootMove(paths.projectRoot);
  await fs16.rm(await resolveContainedNativePath(paths.nativeRoot, nativeSelectionFile(paths)), {
    force: true
  });
}
async function clearNativeSelectionIfLocked(paths, name) {
  let source;
  try {
    source = await fs16.readFile(
      await resolveContainedNativePath(paths.nativeRoot, nativeSelectionFile(paths)),
      "utf8"
    );
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const value = JSON.parse(source);
  if (value.schema !== "comet.native.selection.v1" || value.change !== name) return false;
  await clearNativeSelectionLocked(paths);
  return true;
}

// domains/comet-native/native-archive.ts
var NativeSpecConflictError = class extends Error {
  constructor(capability, expectedHash, actualHash, canonicalPath) {
    super(
      `Canonical spec conflict for ${capability}: expected ${expectedHash ?? "(missing)"}, actual ${actualHash ?? "(missing)"}`
    );
    this.capability = capability;
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
    this.canonicalPath = canonicalPath;
    this.name = "NativeSpecConflictError";
  }
  capability;
  expectedHash;
  actualHash;
  canonicalPath;
  code = "native-spec-conflict";
};
async function optionalHash(file) {
  try {
    return await sha256File(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function assertArchiveReady(state) {
  if (state.phase !== "archive") throw new Error(`Native change ${state.name} is not in Archive`);
  if (state.verification_result !== "pass") {
    throw new Error(`Native change ${state.name} has not passed verification`);
  }
  if (!state.verification_report) {
    throw new Error(`Native change ${state.name} has no verification report`);
  }
  if (state.archived) throw new Error(`Native change ${state.name} is already archived`);
}
async function assertArchiveArtifacts(paths, state) {
  const changeDir = nativeChangeDir(paths, state.name);
  const brief = await validateNativeBrief(changeDir, state.brief);
  const verification = await validateNativeVerification(changeDir, state.verification_report);
  const findings = [...brief.findings, ...verification.findings];
  if (findings.length > 0) {
    throw new Error(`Native archive artifacts are invalid: ${findings[0].message}`);
  }
}
async function assertSpecBase(paths, change) {
  const canonical = canonicalSpecPath(paths, change.capability);
  await resolveContainedNativePath(paths.nativeRoot, canonical);
  const actual = await optionalHash(canonical);
  const expected = change.operation === "create" ? null : change.base_hash;
  if (actual !== expected) {
    throw new NativeSpecConflictError(change.capability, expected, actual, canonical);
  }
}
function archiveTarget(paths, name, now) {
  return path19.join(paths.archiveDir, `${now.toISOString().slice(0, 10)}-${name}`);
}
async function pathExists(target) {
  try {
    await fs17.access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function buildArchiveJournal(options) {
  const { paths, state, now, transactionId } = options;
  const target = archiveTarget(paths, state.name, now);
  if (await pathExists(target)) throw new Error(`Native archive target already exists: ${target}`);
  const tx = await resolveNativeTransactionPaths(paths, transactionId);
  const operations = [];
  for (const [index, change] of state.spec_changes.entries()) {
    await assertSpecBase(paths, change);
    const canonical = canonicalSpecPath(paths, change.capability);
    const backup = path19.join(tx.backups, "specs", change.capability, "spec.md");
    if (change.operation === "remove") {
      operations.push({
        id: `spec-${index + 1}-${change.capability}`,
        type: "remove",
        target: nativeRootRef(paths, canonical),
        backup: nativeRootRef(paths, backup)
      });
      continue;
    }
    const source = await resolveNativeArtifactFile(
      nativeChangeDir(paths, state.name),
      change.source
    );
    const staged = path19.join(tx.staged, "specs", change.capability, "spec.md");
    await fs17.mkdir(path19.dirname(staged), { recursive: true });
    await fs17.copyFile(source, staged);
    const [sourceHash, stagedHash] = await Promise.all([sha256File(source), sha256File(staged)]);
    if (sourceHash !== stagedHash) throw new Error(`Failed to stage spec ${change.capability}`);
    operations.push({
      id: `spec-${index + 1}-${change.capability}`,
      type: "write",
      target: nativeRootRef(paths, canonical),
      staged: nativeRootRef(paths, staged),
      ...change.operation === "replace" ? { backup: nativeRootRef(paths, backup) } : {}
    });
  }
  operations.push({
    id: "archive-change",
    type: "move",
    source: nativeRootRef(paths, nativeChangeDir(paths, state.name)),
    target: nativeRootRef(paths, target)
  });
  return {
    schema: "comet.native.transaction.v1",
    id: transactionId,
    kind: "archive",
    status: "prepared",
    projectRoot: paths.projectRoot,
    nativeRoot: paths.nativeRoot,
    change: state.name,
    createdAt: now.toISOString(),
    operations
  };
}
function archiveDirectoryFromJournal(paths, journal) {
  const operation = journal.operations.find((item) => item.id === "archive-change");
  if (!operation || operation.type !== "move") {
    throw new Error(`Archive transaction ${journal.id} has no archive move`);
  }
  return path19.resolve(paths.nativeRoot, ...operation.target.split("/"));
}
async function finalizeArchive(paths, journal) {
  const events = await readNativeTransactionEvents(paths, journal.id);
  if (events.some((event2) => event2.type === "archive-finalized")) return;
  if (!events.some((event2) => event2.type === "archive-finalization-started")) {
    await finalizeNativeTransaction(paths, journal, "archive-finalization-started");
  }
  const archiveDir = archiveDirectoryFromJournal(paths, journal);
  const stateFile2 = path19.join(archiveDir, "change.yaml");
  const state = await readNativeChangeFile(stateFile2);
  if (!journal.change || state.name !== journal.change) {
    throw new Error(`Archive transaction ${journal.id} change mismatch`);
  }
  const run = await readRunStateAt(archiveDir, NATIVE_RUN_STORAGE);
  if (!run || run.runId !== state.run_id || run.currentStep !== "archive" && !(run.currentStep === null && run.status === "completed")) {
    throw new Error(`Native archive Run state is missing or inconsistent for ${state.name}`);
  }
  let completed = run;
  if (run.currentStep === "archive") {
    const decision = decideWithResolver(
      NATIVE_RUNTIME_PACKAGE,
      run,
      /* @__PURE__ */ new Set(),
      nativePhaseResolver,
      void 0
    );
    if (!decision.action) throw new Error(decision.reason ?? "Native archive produced no action");
    completed = recordOutcomeWithResolver(
      NATIVE_RUNTIME_PACKAGE,
      decision.state,
      {
        actionId: decision.action.id,
        status: "succeeded",
        summary: `Archived Native change ${state.name}`
      },
      nativePhaseResolver,
      void 0
    );
  }
  const evidenceHash2 = sha256Text(`archive:${journal.id}:${state.name}`);
  if (!state.archived) {
    const updated = { ...state, archived: true };
    await writeNativeChangeFile(stateFile2, updated);
  }
  const trajectory = await readTrajectory(archiveDir, completed.trajectoryRef);
  let event = trajectory.find(
    (item) => item.type === "state_transitioned" && item.data.transactionId === journal.id
  );
  if (!event) {
    event = await appendNativeTrajectoryEvent({
      changeDir: archiveDir,
      run: completed,
      type: "state_transitioned",
      data: {
        previousPhase: "archive",
        nextPhase: null,
        evidenceHash: evidenceHash2,
        summary: `Archived Native change ${state.name}`,
        transactionId: journal.id
      }
    });
  }
  await writeNativeCheckpoint({
    changeDir: archiveDir,
    run: completed,
    trajectoryOffset: event.sequence,
    evidenceHash: evidenceHash2
  });
  await writeRunStateAt(archiveDir, completed, NATIVE_RUN_STORAGE);
  await clearNativeSelectionIfLocked(paths, state.name);
  await finalizeNativeTransaction(paths, journal, "archive-finalized");
}
async function continueArchive(paths, journal, hooks) {
  const applied = await applyNativeTransaction(paths, journal, hooks);
  await finalizeArchive(paths, applied);
  return finalizeNativeTransaction(paths, applied, "commit");
}
function assertMatchingJournal(paths, journal) {
  if (journal.kind !== "archive") throw new Error(`Transaction ${journal.id} is not an archive`);
  if (path19.resolve(journal.projectRoot) !== path19.resolve(paths.projectRoot) || path19.resolve(journal.nativeRoot) !== path19.resolve(paths.nativeRoot)) {
    throw new Error(`Transaction ${journal.id} belongs to a different Native root`);
  }
}
async function archiveNativeChange(options) {
  return withNativeMutationLock(
    options.paths,
    `archive ${options.name}`,
    () => withNativeTransitionLock(options.paths, options.name, `archive ${options.name}`, async () => {
      await settleNativeChangeJournalsLocked(options.paths, options.name);
      const lock = await acquireNativeLock(options.paths, "archive", `archive ${options.name}`);
      try {
        const state = await readNativeChange(options.paths, options.name);
        assertArchiveReady(state);
        await assertArchiveArtifacts(options.paths, state);
        const now = options.now ?? /* @__PURE__ */ new Date();
        const transactionId = randomUUID7();
        const journal = await buildArchiveJournal({
          paths: options.paths,
          state,
          now,
          transactionId
        });
        await createNativeTransaction(options.paths, journal);
        await options.hooks?.afterPrepared?.(journal);
        await continueArchive(options.paths, journal, options.hooks);
        return { archiveDir: archiveDirectoryFromJournal(options.paths, journal), transactionId };
      } finally {
        await releaseNativeLock(lock);
      }
    })
  );
}
async function recoverArchiveTransaction(options) {
  return withNativeMutationLock(
    options.paths,
    `recover archive ${options.transactionId}`,
    async () => {
      const lock = await acquireNativeLock(
        options.paths,
        "archive",
        `recover archive ${options.transactionId}`
      );
      try {
        const journal = await readNativeTransaction(options.paths, options.transactionId);
        assertMatchingJournal(options.paths, journal);
        if (journal.status === "committed" || journal.status === "rolled-back") return journal;
        return options.strategy === "continue" ? continueArchive(options.paths, journal) : rollbackNativeTransaction(options.paths, journal);
      } finally {
        await releaseNativeLock(lock);
      }
    },
    { allowedTransactionId: options.transactionId }
  );
}

// domains/comet-native/native-diagnostics.ts
import { promises as fs18 } from "fs";

// domains/comet-native/native-run-consistency.ts
import path20 from "path";
function runPath(changeDir, ref) {
  return path20.resolve(changeDir, ...ref.split(/[\\/]/u));
}
async function inspectNativeRunConsistency(paths, state) {
  const findings = [];
  const changeDir = nativeChangeDir(paths, state.name);
  const stateFile2 = runPath(changeDir, NATIVE_RUN_STORAGE.stateRef);
  let run;
  try {
    run = await readRunStateAt(changeDir, NATIVE_RUN_STORAGE);
  } catch (error) {
    return [
      {
        code: "run-state-invalid",
        message: `Native Run state is invalid: ${error.message}`,
        path: stateFile2
      }
    ];
  }
  if (!run) {
    if (state.run_id !== null || state.phase !== "shape") {
      findings.push({
        code: "run-state-missing",
        message: "Native change references a missing Run state",
        path: stateFile2
      });
    }
    return findings;
  }
  if (state.run_id === null) {
    return [
      {
        code: "run-state-unexpected",
        message: "Native change has a Run state but no run_id",
        path: stateFile2
      }
    ];
  }
  if (run.runId !== state.run_id) {
    findings.push({
      code: "run-id-mismatch",
      message: `Native Run id ${run.runId} does not match change run_id ${state.run_id}`,
      path: stateFile2
    });
  }
  if (run.pending || run.status === "waiting") {
    findings.push({
      code: "run-action-pending",
      message: "Native Run has an unresolved pending action",
      path: stateFile2
    });
  }
  if (run.currentStep !== state.phase) {
    findings.push({
      code: "run-phase-mismatch",
      message: `Native Run step ${run.currentStep ?? "(none)"} does not match phase ${state.phase}`,
      path: stateFile2
    });
  }
  const trajectoryFile2 = runPath(changeDir, run.trajectoryRef);
  const tailInspection = await inspectNativeTrajectoryTail(paths, state.name);
  if (tailInspection.status === "repairable") {
    findings.push({
      code: "trajectory-tail-incomplete",
      message: `Native trajectory final line is incomplete at line ${tailInspection.line}; doctor repair can discard ${tailInspection.discardedBytes} incomplete byte(s)`,
      path: trajectoryFile2
    });
    return findings;
  }
  if (tailInspection.status === "invalid") {
    findings.push({
      code: "trajectory-invalid",
      message: `Native trajectory is invalid at line ${tailInspection.line}: ${tailInspection.message}`,
      path: trajectoryFile2
    });
    return findings;
  }
  let trajectory;
  try {
    trajectory = await readTrajectory(changeDir, run.trajectoryRef);
    if (trajectory.length === 0 || trajectory.some(
      (event, index) => !event || typeof event !== "object" || event.sequence !== index + 1 || event.runId !== run.runId || typeof event.type !== "string" || !event.data || typeof event.data !== "object" || Array.isArray(event.data)
    )) {
      throw new Error("trajectory events are missing or inconsistent");
    }
  } catch (error) {
    findings.push({
      code: "trajectory-invalid",
      message: `Native trajectory is invalid: ${error.message}`,
      path: trajectoryFile2
    });
    return findings;
  }
  const checkpointFile = runPath(changeDir, run.checkpointRef);
  try {
    const checkpoint = await readCheckpoint(changeDir, run.checkpointRef);
    if (!checkpoint) {
      findings.push({
        code: "checkpoint-missing",
        message: "Native Run checkpoint is missing",
        path: checkpointFile
      });
    } else if (checkpoint.runId !== run.runId || checkpoint.stateVersion !== run.iteration || checkpoint.trajectoryOffset !== trajectory.length) {
      findings.push({
        code: "checkpoint-mismatch",
        message: "Native Run checkpoint does not match Run state and trajectory",
        path: checkpointFile
      });
    }
  } catch (error) {
    findings.push({
      code: "checkpoint-invalid",
      message: `Native Run checkpoint is invalid: ${error.message}`,
      path: checkpointFile
    });
  }
  return findings;
}

// domains/comet-native/native-continuation.ts
var REPAIR_CODES = /^(?:run-|trajectory-|checkpoint-(?:missing|mismatch|invalid|progress-invalid)|transition-(?:incomplete|invalid))/u;
function requiredPhaseInputs(state) {
  if (state.phase === "shape") return ["summary"];
  if (state.phase === "build") return ["summary", "artifact-or-no-code-reason"];
  if (state.phase === "verify") return ["summary", "verification-result", "verification-report"];
  return [];
}
function nativeContinuation(options) {
  const findings = options.findings ?? [];
  const decision = findings.find((finding) => finding.requiresUserDecision);
  const repair = findings.find(
    (finding) => finding.repairCommand !== null || REPAIR_CODES.test(finding.code)
  );
  const requiredInputs = [...new Set(findings.map((finding) => finding.requiredAction))].sort();
  if (options.done) {
    return {
      schema: "comet.native.continuation.v1",
      skill: "comet-native",
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: "done",
      action: "none",
      command: null,
      requiresUserDecision: false,
      requiredInputs: []
    };
  }
  if (decision) {
    return {
      schema: "comet.native.continuation.v1",
      skill: "comet-native",
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: "await-user",
      action: "work-phase",
      command: null,
      requiresUserDecision: true,
      requiredInputs
    };
  }
  if (repair) {
    return {
      schema: "comet.native.continuation.v1",
      skill: "comet-native",
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: "blocked",
      action: "repair",
      command: repair.repairCommand,
      requiresUserDecision: false,
      requiredInputs
    };
  }
  if (findings.length > 0) {
    return {
      schema: "comet.native.continuation.v1",
      skill: "comet-native",
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: "continue",
      action: "work-phase",
      command: null,
      requiresUserDecision: false,
      requiredInputs
    };
  }
  if (options.state.phase === "archive") {
    return {
      schema: "comet.native.continuation.v1",
      skill: "comet-native",
      change: options.state.name,
      phase: options.state.phase,
      revision: options.state.revision,
      disposition: options.archiveReady ? "continue" : "blocked",
      action: options.archiveReady ? "archive" : "none",
      command: options.archiveReady ? `comet native archive ${options.state.name}` : null,
      requiresUserDecision: false,
      requiredInputs: options.archiveReady ? [] : ["archive-readiness"]
    };
  }
  return {
    schema: "comet.native.continuation.v1",
    skill: "comet-native",
    change: options.state.name,
    phase: options.state.phase,
    revision: options.state.revision,
    disposition: "continue",
    action: "advance-phase",
    command: `comet native next ${options.state.name} --summary "<summary>"`,
    requiresUserDecision: false,
    requiredInputs: requiredPhaseInputs(options.state)
  };
}

// domains/comet-native/native-findings.ts
import path21 from "path";
var FINDING_SUMMARY_CODE_BUDGET = 8;
var EXACT_METADATA = {
  "brief-blocking-question": {
    severity: "error",
    requiredAction: "answer-blocking-question",
    retry: "next",
    repair: "none"
  },
  "transition-incomplete": {
    severity: "error",
    requiredAction: "recover-transition",
    retry: "status",
    repair: "doctor"
  },
  "trajectory-tail-incomplete": {
    severity: "error",
    requiredAction: "repair-trajectory-tail",
    retry: "status",
    repair: "doctor"
  },
  "checkpoint-progress-invalid": {
    severity: "error",
    requiredAction: "manually-isolate-invalid-checkpoint",
    retry: "none",
    repair: "none"
  },
  "checkpoint-progress-incomplete": {
    severity: "error",
    requiredAction: "recover-progress-checkpoint",
    retry: "status",
    repair: "doctor"
  },
  "checkpoint-manifest-invalid": {
    severity: "error",
    requiredAction: "record-checkpoint-again",
    retry: "status",
    repair: "none"
  }
};
function inferredMetadata(code) {
  const exact = EXACT_METADATA[code];
  if (exact) return exact;
  if (/^(?:run-|trajectory-|checkpoint-(?:missing|mismatch|invalid)|transition-invalid)/u.test(code)) {
    return {
      severity: "error",
      requiredAction: "repair-native-runtime",
      retry: "status",
      repair: "doctor"
    };
  }
  if (code.startsWith("brief-")) {
    return {
      severity: "error",
      requiredAction: "complete-brief",
      retry: "next",
      repair: "none"
    };
  }
  if (code.startsWith("spec-")) {
    return {
      severity: "error",
      requiredAction: "resolve-spec-state",
      retry: "next",
      repair: "none"
    };
  }
  if (code.startsWith("verification-")) {
    return {
      severity: "error",
      requiredAction: "complete-verification-evidence",
      retry: "next",
      repair: "none"
    };
  }
  if (code.startsWith("build-")) {
    return {
      severity: "error",
      requiredAction: "record-build-evidence",
      retry: "next",
      repair: "none"
    };
  }
  return {
    severity: "error",
    requiredAction: "resolve-finding",
    retry: "status",
    repair: "none"
  };
}
function projectRelativePath(paths, state, finding) {
  if (!finding.path) return null;
  let target;
  if (path21.isAbsolute(finding.path)) {
    target = path21.resolve(finding.path);
  } else if (/^(?:brief-|verification-|spec-source)/u.test(finding.code)) {
    target = path21.resolve(nativeChangeDir(paths, state.name), ...finding.path.split(/[\\/]/u));
  } else {
    target = path21.resolve(paths.projectRoot, ...finding.path.split(/[\\/]/u));
  }
  if (!isInsidePath(paths.projectRoot, target)) return null;
  const relative = path21.relative(paths.projectRoot, target).replaceAll("\\", "/");
  return relative === "" ? "." : relative;
}
function retryCommand(retry, state) {
  if (retry === "next") return `comet native next ${state.name} --summary "<summary>"`;
  if (retry === "status") return `comet native status ${state.name} --details`;
  return null;
}
function structureNativeFindings(options) {
  return options.findings.map((finding) => {
    const metadata = inferredMetadata(finding.code);
    return {
      code: finding.code,
      message: finding.message,
      severity: metadata.severity,
      path: projectRelativePath(options.paths, options.state, finding),
      requiredAction: metadata.requiredAction,
      retryCommand: retryCommand(metadata.retry, options.state),
      repairCommand: metadata.repair === "doctor" ? `comet native doctor ${options.state.name} --repair${finding.code.startsWith("transition-") ? " --strategy continue" : ""}` : null,
      // This is intentionally code-based, not severity-based. Model-actionable
      // missing data must never be presented as a user decision.
      requiresUserDecision: finding.code === "brief-blocking-question"
    };
  }).sort((left, right) => {
    const severityRank = { error: 0, warning: 1, info: 2 };
    return severityRank[left.severity] - severityRank[right.severity] || left.code.localeCompare(right.code) || (left.path ?? "").localeCompare(right.path ?? "") || left.message.localeCompare(right.message);
  });
}
function summarizeNativeFindings(findings) {
  const codes = [...new Set(findings.map((finding) => finding.code))];
  return {
    total: findings.length,
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    info: findings.filter((finding) => finding.severity === "info").length,
    requiresUserDecision: findings.some((finding) => finding.requiresUserDecision),
    codes: codes.slice(0, FINDING_SUMMARY_CODE_BUDGET),
    truncated: codes.length > FINDING_SUMMARY_CODE_BUDGET
  };
}

// domains/comet-native/native-resume-view.ts
import path22 from "path";
var COMPACT_TEXT_BUDGET = 240;
var COMPACT_REASON_CODE_BUDGET = 8;
var NATIVE_INSPECTION_REASON_DETAIL_BUDGET = 50;
function compactText(value) {
  const characters = Array.from(value);
  return characters.length <= COMPACT_TEXT_BUDGET ? value : `${characters.slice(0, COMPACT_TEXT_BUDGET - 1).join("")}…`;
}
function reasonCode(reason) {
  const separator = reason.indexOf(":");
  return separator < 0 ? reason : reason.slice(0, separator);
}
function inspectionViews(reasons) {
  const codes = [...new Set(reasons.map(reasonCode))];
  const inspection = {
    freshness: reasons.length === 0 || reasons.length === 1 && reasons[0] === "no-checkpoint" ? "fresh" : "stale",
    codes: codes.slice(0, COMPACT_REASON_CODE_BUDGET),
    reasonCount: reasons.length,
    codesTruncated: codes.length > COMPACT_REASON_CODE_BUDGET
  };
  return {
    inspection,
    inspectionDetails: {
      ...inspection,
      reasons: reasons.slice(0, NATIVE_INSPECTION_REASON_DETAIL_BUDGET),
      reasonsTruncated: reasons.length > NATIVE_INSPECTION_REASON_DETAIL_BUDGET
    }
  };
}
async function buildNativeResumeView(options) {
  let pendingFinding = null;
  try {
    const pending = await readNativeCheckpointJournal(options.paths, options.state.name);
    if (pending) {
      pendingFinding = {
        code: "checkpoint-progress-incomplete",
        message: `Native progress checkpoint ${pending.id} requires deterministic recovery`,
        path: nativeCheckpointJournalFile(options.paths, options.state.name)
      };
    }
  } catch (error) {
    pendingFinding = {
      code: "checkpoint-progress-invalid",
      message: `Native progress checkpoint journal is invalid: ${error.message}. Automatic repair is unavailable; inspect and move the invalid checkpoint journal aside before retrying`,
      path: nativeCheckpointJournalFile(options.paths, options.state.name)
    };
  }
  const inspected = await inspectNativeCheckpointFreshness({
    paths: options.paths,
    name: options.state.name,
    stateRevision: options.state.revision
  });
  const allReasons = pendingFinding ? [pendingFinding.code, ...inspected.reasons] : inspected.reasons;
  const views = inspectionViews(allReasons);
  if (!inspected.checkpoint) {
    return {
      inspection: views.inspection,
      inspectionDetails: views.inspectionDetails,
      checkpoint: null,
      checkpointDetails: null,
      findings: pendingFinding ? [pendingFinding, ...inspected.findings] : inspected.findings,
      maxCheckpointArtifacts: NATIVE_CHECKPOINT_LIMITS.maxArtifacts
    };
  }
  const compact = {
    id: inspected.checkpoint.id,
    createdAt: inspected.checkpoint.createdAt,
    phase: inspected.checkpoint.phase,
    stateRevision: inspected.checkpoint.stateRevision,
    summary: compactText(inspected.checkpoint.summary),
    nextAction: compactText(inspected.checkpoint.nextAction),
    artifactCount: inspected.checkpoint.artifactCount
  };
  const details = inspected.manifest ? {
    ...compact,
    summary: inspected.checkpoint.summary,
    nextAction: inspected.checkpoint.nextAction,
    manifestHash: inspected.checkpoint.manifestHash,
    manifestRef: path22.relative(
      options.paths.projectRoot,
      path22.join(
        nativeChangeDir(options.paths, options.state.name),
        ...inspected.checkpoint.manifestRef.split("/")
      )
    ).replaceAll("\\", "/"),
    artifacts: inspected.manifest.artifacts,
    totalBytes: inspected.manifest.totalBytes
  } : null;
  return {
    inspection: views.inspection,
    inspectionDetails: views.inspectionDetails,
    checkpoint: compact,
    checkpointDetails: details,
    findings: pendingFinding ? [pendingFinding, ...inspected.findings] : inspected.findings,
    maxCheckpointArtifacts: NATIVE_CHECKPOINT_LIMITS.maxArtifacts
  };
}

// domains/comet-native/native-diagnostics.ts
async function selectedName(paths) {
  try {
    const value = JSON.parse(await fs18.readFile(nativeSelectionFile(paths), "utf8"));
    return value.schema === "comet.native.selection.v1" && typeof value.change === "string" ? value.change : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
}
function nativeNextCommand(state, archiveReady) {
  if (state.phase === "archive") {
    return archiveReady ? `comet native archive ${state.name}` : null;
  }
  return `comet native next ${state.name} --summary "<summary>"`;
}
async function statusFindings(paths, state) {
  const changeDir = nativeChangeDir(paths, state.name);
  const findings = [
    ...(await validateNativeBrief(changeDir, state.brief)).findings,
    ...(await validateNativeSpecChanges(paths, state)).findings,
    ...await inspectNativeRunConsistency(paths, state)
  ];
  try {
    if (await inspectPendingNativeTransition(paths, state.name)) {
      findings.unshift({
        code: "transition-incomplete",
        message: "Native phase transition recovery is pending"
      });
    }
  } catch (error) {
    findings.unshift({
      code: "transition-invalid",
      message: `Native transition journal is invalid: ${error.message}`
    });
  }
  if (state.verification_report) {
    findings.push(
      ...(await validateNativeVerification(changeDir, state.verification_report)).findings
    );
  } else if (state.phase === "verify" || state.phase === "archive" || state.verification_result === "pass") {
    findings.push({
      code: "verification-report-missing",
      message: "Native change has no verification report"
    });
  }
  return findings;
}
async function inspectNativeStatus(paths, name, options) {
  const selected = await selectedName(paths) === name;
  let state;
  try {
    const inspection = await inspectNativeChange(paths, name);
    if (inspection.status === "migration-required" && inspection.state) {
      return {
        name,
        phase: inspection.state.phase,
        revision: "revision" in inspection.state ? inspection.state.revision : null,
        approval: inspection.state.approval,
        verificationResult: inspection.state.verification_result,
        specChanges: inspection.state.spec_changes.length,
        selected,
        nextCommand: null,
        archiveReady: false,
        inspection: {
          freshness: "stale",
          codes: ["migration-required"],
          reasonCount: 1,
          codesTruncated: false
        },
        findingSummary: {
          total: 0,
          errors: 0,
          warnings: 0,
          info: 0,
          requiresUserDecision: false,
          codes: [],
          truncated: false
        },
        detailsCommand: `comet native status ${name} --details`,
        checkpoint: null,
        continuation: null,
        schema: inspection.schema,
        migrationRequired: true,
        minimumRuntimeVersion: inspection.minimumRuntimeVersion,
        error: inspection.message
      };
    }
    if (inspection.status !== "current" || !inspection.state) {
      return {
        name,
        phase: "invalid",
        revision: null,
        approval: null,
        verificationResult: "pending",
        specChanges: 0,
        selected,
        nextCommand: null,
        archiveReady: false,
        inspection: {
          freshness: "stale",
          codes: ["runtime-incompatible"],
          reasonCount: 1,
          codesTruncated: false
        },
        findingSummary: {
          total: 0,
          errors: 0,
          warnings: 0,
          info: 0,
          requiresUserDecision: false,
          codes: [],
          truncated: false
        },
        detailsCommand: `comet native status ${name} --details`,
        checkpoint: null,
        continuation: null,
        schema: inspection.schema,
        minimumRuntimeVersion: inspection.minimumRuntimeVersion,
        error: inspection.message ?? `Native change ${name} is incompatible`
      };
    }
    state = inspection.state;
  } catch (error) {
    return {
      name,
      phase: "invalid",
      revision: null,
      approval: null,
      verificationResult: "pending",
      specChanges: 0,
      selected,
      nextCommand: null,
      archiveReady: false,
      inspection: {
        freshness: "stale",
        codes: ["change-invalid"],
        reasonCount: 1,
        codesTruncated: false
      },
      findingSummary: {
        total: 0,
        errors: 0,
        warnings: 0,
        info: 0,
        requiresUserDecision: false,
        codes: [],
        truncated: false
      },
      detailsCommand: `comet native status ${name} --details`,
      checkpoint: null,
      continuation: null,
      error: error.message
    };
  }
  const resume = await buildNativeResumeView({ paths, state });
  const rawFindings = [...await statusFindings(paths, state), ...resume.findings];
  const findings = structureNativeFindings({ paths, state, findings: rawFindings });
  const archiveReady = state.phase === "archive" && state.verification_result === "pass" && findings.length === 0;
  const mutationBlocked = findings.some(
    (finding) => finding.code === "trajectory-tail-incomplete" || finding.code === "trajectory-invalid"
  );
  return {
    name: state.name,
    phase: state.phase,
    revision: state.revision,
    approval: state.approval,
    verificationResult: state.verification_result,
    specChanges: state.spec_changes.length,
    selected,
    nextCommand: mutationBlocked ? null : nativeNextCommand(state, archiveReady),
    archiveReady,
    inspection: resume.inspection,
    findingSummary: summarizeNativeFindings(findings),
    detailsCommand: `comet native status ${state.name} --details`,
    checkpoint: resume.checkpoint,
    continuation: nativeContinuation({ state, findings, archiveReady }),
    ...options?.details ? {
      findings: findings.slice(0, 50),
      inspectionDetails: resume.inspectionDetails,
      checkpointDetails: resume.checkpointDetails,
      budgets: {
        maxFindings: 50,
        maxInspectionReasons: NATIVE_INSPECTION_REASON_DETAIL_BUDGET,
        maxCheckpointArtifacts: resume.maxCheckpointArtifacts,
        findingsTruncated: findings.length > 50,
        inspectionReasonsTruncated: resume.inspectionDetails.reasonsTruncated,
        checkpointArtifactsTruncated: false
      }
    } : {},
    schema: state.schema,
    minimumRuntimeVersion: state.minimum_runtime_version,
    ...findings[0] ? { error: findings[0].message } : {}
  };
}
async function listNativeStatus(paths) {
  let entries;
  try {
    entries = await fs18.readdir(paths.changesDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const names = entries.filter((entry2) => entry2.isDirectory() && !entry2.isSymbolicLink()).map((entry2) => entry2.name).sort();
  return Promise.all(names.map((name) => inspectNativeStatus(paths, name)));
}

// domains/comet-native/native-doctor.ts
import { promises as fs21 } from "fs";
import path25 from "path";

// domains/comet-native/native-root-move.ts
import { randomUUID as randomUUID8 } from "crypto";
import { promises as fs19 } from "fs";
import path23 from "path";
async function exists2(target) {
  try {
    await fs19.access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function assertNoUnfinishedTransactions(paths) {
  let entries;
  try {
    entries = await fs19.readdir(paths.transactionsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry2 of entries) {
    if (!entry2.isDirectory() || entry2.isSymbolicLink()) continue;
    let journal;
    try {
      journal = await readNativeTransaction(paths, entry2.name);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(
          `Native transaction ${entry2.name} has no journal; run doctor before moving`,
          { cause: error }
        );
      }
      throw error;
    }
    if (journal.status !== "committed" && journal.status !== "rolled-back") {
      throw new Error(`Native transaction ${journal.id} is unfinished; recover it before moving`);
    }
  }
}
async function assertNoOtherLocks(paths, ownedLock) {
  for (const entry2 of await fs19.readdir(paths.locksDir, { withFileTypes: true })) {
    const file = path23.join(paths.locksDir, entry2.name);
    if (path23.resolve(file) === path23.resolve(ownedLock)) continue;
    if (entry2.isFile() || entry2.isSymbolicLink()) {
      throw new Error(`Native lock must be diagnosed before moving the root: ${file}`);
    }
  }
}
async function walkTree(root, options) {
  const files = [];
  async function visit(directory) {
    const entries = await fs19.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry2 of entries) {
      const target = path23.join(directory, entry2.name);
      if (options.excludedFiles?.has(path23.resolve(target))) continue;
      if (entry2.isSymbolicLink()) {
        if (options.rejectSymlinks) throw new Error(`Native root contains a symlink: ${target}`);
        continue;
      }
      if (entry2.isDirectory()) {
        await visit(target);
      } else if (entry2.isFile()) {
        const stat = await fs19.stat(target);
        files.push({
          ref: path23.relative(root, target).split(path23.sep).join("/"),
          size: stat.size,
          hash: await sha256File(target)
        });
      }
    }
  }
  await visit(root);
  return files;
}
async function copyTree(source, target, excludedFile) {
  await fs19.mkdir(path23.dirname(target), { recursive: true });
  await fs19.mkdir(target, { recursive: false });
  async function copyDirectory(from, to) {
    const entries = await fs19.readdir(from, { withFileTypes: true });
    for (const entry2 of entries) {
      const sourceEntry = path23.join(from, entry2.name);
      if (path23.resolve(sourceEntry) === path23.resolve(excludedFile)) continue;
      if (entry2.isSymbolicLink()) throw new Error(`Native root contains a symlink: ${sourceEntry}`);
      const targetEntry = path23.join(to, entry2.name);
      if (entry2.isDirectory()) {
        await fs19.mkdir(targetEntry);
        await copyDirectory(sourceEntry, targetEntry);
      } else if (entry2.isFile()) {
        await fs19.copyFile(sourceEntry, targetEntry);
      }
    }
  }
  await copyDirectory(source, target);
}
async function assertEquivalentTrees(source, target, excludedSourceLock) {
  const sourceFiles = await walkTree(source, {
    rejectSymlinks: true,
    excludedFiles: excludedSourceLock ? /* @__PURE__ */ new Set([path23.resolve(excludedSourceLock)]) : void 0
  });
  const targetFiles = await walkTree(target, { rejectSymlinks: true });
  if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) {
    throw new Error(
      `Native root copies differ; preserve both trees for manual recovery: ${source} and ${target}`
    );
  }
}
function stagingDirectory(targetPaths, id) {
  return path23.join(targetPaths.artifactRoot, `.comet-native-move-${id}`);
}
function pendingConfig(config, pending, activeArtifactRoot = config.native.artifact_root) {
  return {
    ...config,
    native: { artifact_root: activeArtifactRoot, pending_root_move: pending }
  };
}
function rootMoveJournal(options) {
  return {
    schema: "comet.native.transaction.v1",
    id: options.id,
    kind: "root-move",
    status: "prepared",
    projectRoot: options.paths.projectRoot,
    nativeRoot: options.paths.nativeRoot,
    createdAt: options.now.toISOString(),
    operations: []
  };
}
async function readRootMoveJournal(sourcePaths, destinationPaths, stage, id) {
  for (const paths of [sourcePaths, destinationPaths]) {
    try {
      const journal = await readNativeTransaction(paths, id);
      if (journal.kind !== "root-move") throw new Error(`Transaction ${id} is not a root move`);
      return { journal, paths };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const stageJournal = path23.join(stage, "runtime", "transactions", id, "transaction.json");
  try {
    const journal = JSON.parse(await fs19.readFile(stageJournal, "utf8"));
    if (journal.schema !== "comet.native.transaction.v1" || journal.kind !== "root-move") {
      throw new Error(`Invalid staged root-move journal: ${id}`);
    }
    return { journal, paths: destinationPaths };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(`Native root-move journal is missing: ${id}`, { cause: error });
  }
}
async function setPendingStage(options) {
  const updated = pendingConfig(
    options.config,
    { ...options.pending, stage: options.stage },
    options.activeArtifactRoot
  );
  await writeProjectConfig(options.projectRoot, updated);
  return updated;
}
async function finishForwardMove(options) {
  let config = options.config;
  let stage = config.native.pending_root_move.stage;
  if (stage === "copying") {
    if (!await exists2(options.sourcePaths.nativeRoot)) {
      throw new Error(`Native source root is missing: ${options.sourcePaths.nativeRoot}`);
    }
    if (await exists2(options.staging)) await fs19.rm(options.staging, { recursive: true });
    await walkTree(options.sourcePaths.nativeRoot, {
      rejectSymlinks: true,
      excludedFiles: /* @__PURE__ */ new Set([path23.resolve(options.lockFile)])
    });
    await copyTree(options.sourcePaths.nativeRoot, options.staging, options.lockFile);
    await assertEquivalentTrees(options.sourcePaths.nativeRoot, options.staging, options.lockFile);
    config = await setPendingStage({
      projectRoot: options.projectRoot,
      config,
      pending: options.pending,
      stage: "ready"
    });
    stage = "ready";
    await options.hooks?.afterRootMoveStage?.("ready", options.journal);
  }
  if (stage === "ready") {
    if (await exists2(options.destinationPaths.nativeRoot)) {
      if (await exists2(options.staging)) {
        throw new Error(`Native destination is occupied: ${options.destinationPaths.nativeRoot}`);
      }
      await assertEquivalentTrees(
        options.sourcePaths.nativeRoot,
        options.destinationPaths.nativeRoot,
        options.lockFile
      );
    } else {
      if (!await exists2(options.staging)) throw new Error(`Native move staging tree is missing`);
      await assertEquivalentTrees(
        options.sourcePaths.nativeRoot,
        options.staging,
        options.lockFile
      );
      await fs19.rename(options.staging, options.destinationPaths.nativeRoot);
    }
    config = await setPendingStage({
      projectRoot: options.projectRoot,
      config,
      pending: options.pending,
      stage: "switched",
      activeArtifactRoot: options.pending.toArtifactRoot
    });
    stage = "switched";
    await options.hooks?.afterRootMoveStage?.("switched", options.journal);
  }
  if (stage !== "switched") throw new Error(`Unsupported Native root-move stage: ${stage}`);
  if (!await exists2(options.destinationPaths.nativeRoot)) {
    throw new Error(`Native destination root is missing: ${options.destinationPaths.nativeRoot}`);
  }
  if (await exists2(options.sourcePaths.nativeRoot)) {
    await assertEquivalentTrees(
      options.sourcePaths.nativeRoot,
      options.destinationPaths.nativeRoot,
      options.lockFile
    );
    await fs19.rm(options.sourcePaths.nativeRoot, { recursive: true });
  }
  const destinationJournal = await readNativeTransaction(
    options.destinationPaths,
    options.pending.id
  );
  await finalizeNativeTransaction(options.destinationPaths, destinationJournal, "commit");
  const committed = {
    ...config,
    native: { artifact_root: options.pending.toArtifactRoot }
  };
  await writeProjectConfig(options.projectRoot, committed);
  return committed;
}
async function moveNativeRoot(options) {
  const current = await readProjectConfig(options.projectRoot) ?? defaultProjectConfig(".");
  if (current.native.pending_root_move) {
    throw new Error(
      `Native root move ${current.native.pending_root_move.id} is already incomplete`
    );
  }
  const toArtifactRoot = normalizeArtifactRootRef(options.toArtifactRoot);
  if (toArtifactRoot === current.native.artifact_root) {
    throw new Error(`Native artifact root is already ${toArtifactRoot}`);
  }
  const sourcePaths = await nativeProjectPaths(options.projectRoot, current.native.artifact_root);
  const destinationPaths = await nativeProjectPaths(options.projectRoot, toArtifactRoot);
  if (isInsidePath(sourcePaths.nativeRoot, destinationPaths.nativeRoot) || isInsidePath(destinationPaths.nativeRoot, sourcePaths.nativeRoot)) {
    throw new Error("Native source and destination roots must not overlap");
  }
  if (!await exists2(sourcePaths.nativeRoot)) {
    throw new Error(`Native source root does not exist: ${sourcePaths.nativeRoot}`);
  }
  await assertNoUnfinishedTransactions(sourcePaths);
  if (await exists2(destinationPaths.nativeRoot)) {
    throw new Error(`Native destination is occupied: ${destinationPaths.nativeRoot}`);
  }
  const lock = await acquireNativeLock(sourcePaths, "root-move", `move root to ${toArtifactRoot}`);
  const id = randomUUID8();
  const pending = {
    id,
    fromArtifactRoot: current.native.artifact_root,
    toArtifactRoot,
    stage: "copying"
  };
  const journal = rootMoveJournal({ id, paths: sourcePaths, now: options.now ?? /* @__PURE__ */ new Date() });
  const staging = stagingDirectory(destinationPaths, id);
  try {
    await assertNoOtherLocks(sourcePaths, lock.file);
    if (await exists2(staging)) throw new Error(`Native move staging path is occupied: ${staging}`);
    await writeProjectConfig(options.projectRoot, pendingConfig(current, pending));
    await createNativeTransaction(sourcePaths, journal);
    await options.hooks?.afterRootMoveStage?.("copying", journal);
    await finishForwardMove({
      projectRoot: options.projectRoot,
      config: pendingConfig(current, pending),
      pending,
      sourcePaths,
      destinationPaths,
      staging,
      journal,
      lockFile: lock.file,
      hooks: options.hooks
    });
    return {
      fromNativeRoot: sourcePaths.nativeRoot,
      toNativeRoot: destinationPaths.nativeRoot,
      transactionId: id
    };
  } finally {
    await releaseNativeLock(lock);
  }
}
async function recoverNativeRootMove(options) {
  const config = await readProjectConfig(options.projectRoot);
  const pending = config?.native.pending_root_move;
  if (!config || !pending) throw new Error("No pending Native root move was found");
  const sourcePaths = await nativeProjectPaths(options.projectRoot, pending.fromArtifactRoot);
  const destinationPaths = await nativeProjectPaths(options.projectRoot, pending.toArtifactRoot);
  const staging = stagingDirectory(destinationPaths, pending.id);
  const lockPaths = await exists2(sourcePaths.nativeRoot) ? sourcePaths : destinationPaths;
  const lock = await acquireNativeLock(lockPaths, "root-move", `recover root ${pending.id}`);
  try {
    let journalInfo;
    try {
      journalInfo = await readRootMoveJournal(sourcePaths, destinationPaths, staging, pending.id);
    } catch (error) {
      if (pending.stage !== "copying" || !await exists2(sourcePaths.nativeRoot)) throw error;
      const journal = rootMoveJournal({ id: pending.id, paths: sourcePaths, now: /* @__PURE__ */ new Date() });
      await createNativeTransaction(sourcePaths, journal);
      journalInfo = { journal, paths: sourcePaths };
    }
    if (options.strategy === "continue") {
      const committed = await finishForwardMove({
        projectRoot: options.projectRoot,
        config,
        pending,
        sourcePaths,
        destinationPaths,
        staging,
        journal: journalInfo.journal,
        lockFile: lock.file
      });
      return { activeNativeRoot: destinationPaths.nativeRoot, config: committed };
    }
    if (!await exists2(sourcePaths.nativeRoot)) {
      throw new Error("Cannot roll back after the old Native root was removed; continue recovery");
    }
    if (await exists2(destinationPaths.nativeRoot)) {
      await assertEquivalentTrees(sourcePaths.nativeRoot, destinationPaths.nativeRoot, lock.file);
      await fs19.rm(destinationPaths.nativeRoot, { recursive: true });
    }
    if (await exists2(staging)) {
      await assertEquivalentTrees(sourcePaths.nativeRoot, staging, lock.file);
      await fs19.rm(staging, { recursive: true });
    }
    const sourceJournal = await readNativeTransaction(sourcePaths, pending.id);
    await rollbackNativeTransaction(sourcePaths, sourceJournal);
    const restored = {
      ...config,
      native: { artifact_root: pending.fromArtifactRoot }
    };
    await writeProjectConfig(options.projectRoot, restored);
    return { activeNativeRoot: sourcePaths.nativeRoot, config: restored };
  } finally {
    await releaseNativeLock(lock);
  }
}

// domains/comet-native/native-schema-migration.ts
var import_yaml3 = __toESM(require_dist(), 1);
import { randomUUID as randomUUID9 } from "crypto";
import { promises as fs20 } from "fs";
import path24 from "path";
var HASH_PATTERN4 = /^[a-f0-9]{64}$/u;
function transitionContent(journal) {
  return JSON.stringify(journal, null, 2) + "\n";
}
function upgradeLegacyState(state, revision) {
  return {
    ...state,
    schema: NATIVE_CHANGE_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision
  };
}
function upgradeLegacyTransition(journal) {
  return {
    ...journal,
    schema: NATIVE_TRANSITION_SCHEMA,
    minimum_runtime_version: NATIVE_RUNTIME_PROTOCOL_VERSION,
    revision: 1,
    previousState: upgradeLegacyState(journal.previousState, 1),
    nextState: upgradeLegacyState(journal.nextState, 2)
  };
}
function sameLegacyState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function sameCurrentState(left, right) {
  return JSON.stringify(nativeChangeDocument(left)) === JSON.stringify(nativeChangeDocument(right));
}
function nativeSchemaMigrationJournalFile(paths, name) {
  return path24.join(nativeChangeDir(paths, name), "runtime", "schema-migration.json");
}
function parseMigrationJournal(value, expectedName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Native schema migration journal must be an object");
  }
  const journal = value;
  if (journal.schema !== "comet.native.schema-migration.v1") {
    throw new Error("Unsupported Native schema migration journal");
  }
  if (journal.change !== expectedName) throw new Error("Schema migration change mismatch");
  if (journal.fromSchema !== NATIVE_LEGACY_CHANGE_SCHEMA || journal.toSchema !== NATIVE_CHANGE_SCHEMA) {
    throw new Error("Schema migration route is unsupported");
  }
  if (typeof journal.id !== "string" || journal.id.length === 0) {
    throw new Error("Schema migration id is invalid");
  }
  if (typeof journal.sourceHash !== "string" || !HASH_PATTERN4.test(journal.sourceHash) || typeof journal.targetHash !== "string" || !HASH_PATTERN4.test(journal.targetHash)) {
    throw new Error("Schema migration hash is invalid");
  }
  if (typeof journal.createdAt !== "string" || Number.isNaN(Date.parse(journal.createdAt))) {
    throw new Error("Schema migration timestamp is invalid");
  }
  const nextState = parseNativeChangeValue(journal.nextState);
  let transition;
  if (journal.transition !== void 0) {
    if (!journal.transition || typeof journal.transition !== "object") {
      throw new Error("Schema migration transition target is invalid");
    }
    const transitionValue = journal.transition;
    if (typeof transitionValue.sourceHash !== "string" || !HASH_PATTERN4.test(transitionValue.sourceHash) || typeof transitionValue.targetHash !== "string" || !HASH_PATTERN4.test(transitionValue.targetHash)) {
      throw new Error("Schema migration transition hash is invalid");
    }
    const nextJournal = parseNativeTransitionJournalValue(
      transitionValue.nextJournal,
      expectedName
    );
    if (!sameCurrentState(nextState, nextJournal.previousState) && !sameCurrentState(nextState, nextJournal.nextState)) {
      throw new Error("Schema migration state/transition target mismatch");
    }
    transition = {
      sourceHash: transitionValue.sourceHash,
      targetHash: transitionValue.targetHash,
      nextJournal
    };
  }
  if (nextState.name !== expectedName || !transition && nextState.revision !== 1 || transition && nextState.revision !== 1 && nextState.revision !== 2) {
    throw new Error("Schema migration target state is invalid");
  }
  return {
    schema: "comet.native.schema-migration.v1",
    id: journal.id,
    change: expectedName,
    fromSchema: NATIVE_LEGACY_CHANGE_SCHEMA,
    toSchema: NATIVE_CHANGE_SCHEMA,
    sourceHash: journal.sourceHash,
    targetHash: journal.targetHash,
    createdAt: journal.createdAt,
    nextState,
    ...transition ? { transition } : {}
  };
}
async function inspectPendingNativeSchemaMigration(paths, name) {
  const file = nativeSchemaMigrationJournalFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  try {
    return parseMigrationJournal(JSON.parse(await fs20.readFile(file, "utf8")), name);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function ensureMigrationBaseline(paths, name, createdAt) {
  if (await readNativeBaselineManifest(paths, name)) return;
  const baseline = await createNativeContentSnapshot(paths, {
    now: new Date(createdAt),
    origin: "legacy-migration"
  });
  await writeNativeBaselineManifest(paths, name, baseline);
}
async function continueNativeSchemaMigrationLocked(paths, name, hooks) {
  const journal = await inspectPendingNativeSchemaMigration(paths, name);
  if (!journal) return null;
  const changeFile = path24.join(nativeChangeDir(paths, name), "change.yaml");
  const actualHash = await sha256File(changeFile);
  if (actualHash !== journal.targetHash) {
    if (actualHash !== journal.sourceHash) {
      throw new Error(
        `Native schema migration source changed for ${name}: expected ${journal.sourceHash}, actual ${actualHash}`
      );
    }
    await atomicWriteText(changeFile, (0, import_yaml3.stringify)(nativeChangeDocument(journal.nextState)));
    await hooks?.afterStateWritten?.(journal);
  }
  if (journal.transition) {
    const transitionFile = nativeTransitionJournalFile(paths, name);
    const actualTransitionHash = await sha256File(transitionFile);
    if (actualTransitionHash !== journal.transition.targetHash) {
      if (actualTransitionHash !== journal.transition.sourceHash) {
        throw new Error(
          `Native transition migration source changed for ${name}: expected ${journal.transition.sourceHash}, actual ${actualTransitionHash}`
        );
      }
      await atomicWriteJson(transitionFile, journal.transition.nextJournal);
      await hooks?.afterTransitionWritten?.(journal);
    }
  }
  await ensureMigrationBaseline(paths, name, journal.createdAt);
  await fs20.rm(nativeSchemaMigrationJournalFile(paths, name), { force: true });
  return journal.nextState;
}
async function migrateNativeChange(options) {
  return withNativeMutationLock(
    options.paths,
    `migrate schema for ${options.name}`,
    () => withNativeTransitionLock(
      options.paths,
      options.name,
      `migrate schema for ${options.name}`,
      async () => {
        const continued = await continueNativeSchemaMigrationLocked(
          options.paths,
          options.name,
          options.hooks
        );
        if (continued) return continued;
        const pendingTransition = await inspectPendingNativeTransitionSchema(
          options.paths,
          options.name
        );
        if (pendingTransition?.status === "current") {
          throw new Error(
            `Native change ${options.name} has a pending transition; recover it before schema migration`
          );
        }
        const inspection = await inspectNativeChange(options.paths, options.name);
        if (inspection.status === "current" && inspection.state) {
          return inspection.state;
        }
        if (inspection.status !== "migration-required" || !inspection.state) {
          throw new Error(inspection.message ?? `Native change ${options.name} cannot be migrated`);
        }
        const legacyState = inspection.state;
        let nextState = upgradeLegacyState(legacyState, 1);
        let transition;
        if (pendingTransition?.status === "migration-required") {
          const nextJournal = upgradeLegacyTransition(pendingTransition.journal);
          if (sameLegacyState(legacyState, pendingTransition.journal.previousState)) {
            nextState = nextJournal.previousState;
          } else if (sameLegacyState(legacyState, pendingTransition.journal.nextState)) {
            nextState = nextJournal.nextState;
          } else {
            throw new Error(
              `Native change ${options.name} does not match either state in its legacy transition journal`
            );
          }
          const transitionFile = nativeTransitionJournalFile(options.paths, options.name);
          transition = {
            sourceHash: await sha256File(transitionFile),
            targetHash: sha256Text(transitionContent(nextJournal)),
            nextJournal
          };
        }
        const changeFile = path24.join(nativeChangeDir(options.paths, options.name), "change.yaml");
        const targetContent = (0, import_yaml3.stringify)(nativeChangeDocument(nextState));
        const journal = {
          schema: "comet.native.schema-migration.v1",
          id: options.id?.() ?? randomUUID9(),
          change: options.name,
          fromSchema: NATIVE_LEGACY_CHANGE_SCHEMA,
          toSchema: NATIVE_CHANGE_SCHEMA,
          sourceHash: await sha256File(changeFile),
          targetHash: sha256Text(targetContent),
          createdAt: (options.now ?? /* @__PURE__ */ new Date()).toISOString(),
          nextState,
          ...transition ? { transition } : {}
        };
        const journalFile = nativeSchemaMigrationJournalFile(options.paths, options.name);
        await resolveContainedNativePath(options.paths.nativeRoot, journalFile);
        await atomicWriteJson(journalFile, journal);
        await options.hooks?.afterPrepared?.(journal);
        const migrated = await continueNativeSchemaMigrationLocked(
          options.paths,
          options.name,
          options.hooks
        );
        if (!migrated) throw new Error("Native schema migration journal disappeared");
        return migrated;
      }
    )
  );
}

// domains/comet-native/native-doctor.ts
async function directoryEntries(directory) {
  try {
    return await fs21.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function clearStaleRecoveryLocks(files, findings) {
  for (const file of [...new Set(files.map((entry2) => path25.resolve(entry2)))]) {
    let diagnosis;
    try {
      diagnosis = await diagnoseNativeLock(file);
    } catch (error) {
      findings.push({
        severity: "error",
        code: "lock-invalid",
        message: `Native recovery lock is invalid: ${error.message}`,
        path: file
      });
      return false;
    }
    if (diagnosis.status === "missing") continue;
    if (diagnosis.status === "stale") {
      await fs21.rm(file, { force: true });
      findings.push({
        severity: "info",
        code: "stale-recovery-lock-removed",
        message: `Removed stale lock before explicit transaction recovery`,
        path: file
      });
      continue;
    }
    findings.push({
      severity: "error",
      code: diagnosis.status === "active" ? "lock-active" : "lock-owner-unknown",
      message: diagnosis.status === "active" ? `Native recovery lock is still owned by a live process` : `Native recovery lock owner cannot be proven stale`,
      path: file
    });
    return false;
  }
  return true;
}
async function inspectSelection(paths, repair) {
  const file = nativeSelectionFile(paths);
  let value;
  try {
    await resolveContainedNativePath(paths.nativeRoot, file);
    value = JSON.parse(await fs21.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    return [
      {
        severity: "error",
        code: "selection-invalid",
        message: `Native selection is invalid: ${error.message}`,
        path: file
      }
    ];
  }
  if (value.schema !== "comet.native.selection.v1" || typeof value.change !== "string") {
    return [
      {
        severity: "error",
        code: "selection-invalid",
        message: "Native selection has an invalid schema or change name",
        path: file
      }
    ];
  }
  try {
    await readNativeChange(paths, value.change);
    return [];
  } catch (error) {
    if (error.code !== "ENOENT") {
      return [
        {
          severity: "error",
          code: "selection-target-invalid",
          message: `Selected Native change is invalid: ${error.message}`,
          path: file
        }
      ];
    }
  }
  if (repair) {
    await fs21.rm(file, { force: true });
    return [
      {
        severity: "info",
        code: "selection-cleared",
        message: `Cleared stale Native selection ${value.change}`,
        path: file
      }
    ];
  }
  return [
    {
      severity: "warning",
      code: "selection-stale",
      message: `Selected Native change does not exist: ${value.change}`,
      path: file
    }
  ];
}
async function inspectManagedPaths(paths) {
  const findings = [];
  for (const managedPath of [
    paths.specsDir,
    paths.changesDir,
    paths.archiveDir,
    paths.runtimeDir,
    paths.locksDir,
    paths.transactionsDir
  ]) {
    try {
      await resolveContainedNativePath(paths.nativeRoot, managedPath);
    } catch (error) {
      findings.push({
        severity: "error",
        code: "native-path-unsafe",
        message: `Managed Native path is unsafe: ${error.message}`,
        path: managedPath
      });
    }
  }
  return findings;
}
async function inspectTransactions(paths, options) {
  const findings = [];
  const unfinished = [];
  for (const entry2 of await directoryEntries(paths.transactionsDir)) {
    if (!entry2.isDirectory() || entry2.isSymbolicLink()) continue;
    let journal;
    try {
      journal = await readNativeTransaction(paths, entry2.name);
    } catch (error) {
      findings.push({
        severity: "error",
        code: "transaction-invalid",
        message: `Native transaction ${entry2.name} is invalid: ${error.message}`,
        path: path25.join(paths.transactionsDir, entry2.name)
      });
      continue;
    }
    if (journal.status === "committed" || journal.status === "rolled-back") continue;
    if (options.name && journal.change && journal.change !== options.name) continue;
    if (journal.kind !== "archive") {
      unfinished.push(journal);
      findings.push({
        severity: "error",
        code: "root-move-transaction-orphaned",
        message: `Root-move transaction ${journal.id} is incomplete but project config has no matching pending move`
      });
      continue;
    }
    if (options.repair && options.recoveryStrategy) {
      try {
        const locksReady = await clearStaleRecoveryLocks(
          [path25.join(paths.locksDir, "root-move.lock"), path25.join(paths.locksDir, "archive.lock")],
          findings
        );
        if (!locksReady) {
          unfinished.push(journal);
          continue;
        }
        await recoverArchiveTransaction({
          paths,
          transactionId: journal.id,
          strategy: options.recoveryStrategy
        });
        findings.push({
          severity: "info",
          code: "archive-transaction-recovered",
          message: `${options.recoveryStrategy === "continue" ? "Continued" : "Rolled back"} archive transaction ${journal.id}`
        });
      } catch (error) {
        unfinished.push(journal);
        findings.push({
          severity: "error",
          code: "archive-recovery-failed",
          message: `Archive recovery failed: ${error.message}`
        });
      }
    } else {
      unfinished.push(journal);
      findings.push({
        severity: "error",
        code: "archive-transaction-incomplete",
        message: options.repair ? `Archive transaction ${journal.id} needs an explicit recovery strategy` : `Archive transaction ${journal.id} is incomplete`,
        repair: options.recoveryStrategy ?? "continue"
      });
    }
  }
  return { findings, unfinished };
}
async function inspectLocks(paths, repair, unfinished) {
  const findings = [];
  for (const entry2 of await directoryEntries(paths.locksDir)) {
    if (!entry2.isFile() || entry2.isSymbolicLink() || !entry2.name.endsWith(".lock")) continue;
    const file = path25.join(paths.locksDir, entry2.name);
    try {
      const diagnosis = await diagnoseNativeLock(file);
      if (diagnosis.status === "active") {
        findings.push({
          severity: "warning",
          code: "lock-active",
          message: `Native lock is active for ${diagnosis.owner?.operation ?? "an operation"}`,
          path: file
        });
      } else if (diagnosis.status === "unknown") {
        findings.push({
          severity: "warning",
          code: "lock-owner-unknown",
          message: "Native lock owner cannot be proven stale",
          path: file
        });
      } else if (diagnosis.status === "stale") {
        if (repair && unfinished.length === 0) {
          await fs21.rm(file, { force: true });
          findings.push({
            severity: "info",
            code: "stale-lock-removed",
            message: "Removed a Native lock whose local owner process is absent",
            path: file
          });
        } else {
          findings.push({
            severity: unfinished.length > 0 ? "error" : "warning",
            code: "lock-stale",
            message: unfinished.length > 0 ? "Native lock is stale but an unfinished transaction still requires recovery" : "Native lock owner process is absent",
            path: file
          });
        }
      }
    } catch (error) {
      findings.push({
        severity: "error",
        code: "lock-invalid",
        message: `Native lock metadata is invalid: ${error.message}`,
        path: file
      });
    }
  }
  return findings;
}
async function inspectChanges(paths, name) {
  const findings = [];
  const statuses = name ? await listNativeStatus(paths).then((all) => all.filter((status) => status.name === name)) : await listNativeStatus(paths);
  if (name && statuses.length === 0) {
    return [
      {
        severity: "error",
        code: "change-missing",
        message: `Native change does not exist: ${name}`
      }
    ];
  }
  for (const status of statuses) {
    if (status.migrationRequired) continue;
    if (status.phase === "invalid") {
      findings.push({
        severity: "error",
        code: "change-invalid",
        message: status.error ?? `Native change ${status.name} is invalid`,
        path: path25.join(paths.changesDir, status.name, "change.yaml")
      });
      continue;
    }
    const detailed = await inspectNativeStatus(paths, status.name, { details: true });
    for (const artifact of detailed.findings ?? []) {
      if (artifact.code === "trajectory-tail-incomplete" || artifact.code === "checkpoint-progress-incomplete") {
        continue;
      }
      findings.push({
        severity: artifact.severity,
        code: artifact.code,
        message: `${status.name}: ${artifact.message}`,
        ...artifact.path ? { path: path25.join(paths.projectRoot, artifact.path) } : {}
      });
    }
  }
  return findings;
}
async function inspectTrajectoryTailRepairs(paths, options) {
  const findings = [];
  const names = options.name ? [options.name] : (await directoryEntries(paths.changesDir)).filter((entry2) => entry2.isDirectory() && !entry2.isSymbolicLink()).map((entry2) => entry2.name).sort();
  for (const name of names) {
    try {
      const inspection = await inspectNativeTrajectoryTail(paths, name);
      if (inspection.status !== "repairable") continue;
      if (!options.repair) {
        findings.push({
          severity: "error",
          code: "trajectory-tail-incomplete",
          message: `Native trajectory for ${name} has an incomplete final line ${inspection.line}; ${inspection.discardedBytes} byte(s) are outside the last complete event`,
          path: inspection.file,
          repair: "truncate-tail"
        });
        continue;
      }
      const repaired = await repairNativeTrajectoryTail(paths, name);
      if (repaired) {
        findings.push({
          severity: "info",
          code: "trajectory-tail-repaired",
          message: `Removed the incomplete Native trajectory tail for ${name} and preserved all complete events`,
          path: repaired.file
        });
      }
    } catch (error) {
      findings.push({
        severity: "error",
        code: "trajectory-tail-repair-failed",
        message: `Native trajectory tail repair failed for ${name}: ${error.message}`,
        path: path25.join(paths.changesDir, name, "runtime", "trajectory.jsonl")
      });
    }
  }
  return findings;
}
async function inspectSchemaMigrations(paths, options) {
  const findings = [];
  const names = options.name ? [options.name] : (await directoryEntries(paths.changesDir)).filter((entry2) => entry2.isDirectory() && !entry2.isSymbolicLink()).map((entry2) => entry2.name).sort();
  for (const name of names) {
    const file = nativeSchemaMigrationJournalFile(paths, name);
    try {
      const pending = await inspectPendingNativeSchemaMigration(paths, name);
      const inspection = await inspectNativeChange(paths, name);
      if (!pending && inspection.status === "current") continue;
      if (inspection.status === "runtime-incompatible") {
        findings.push({
          severity: "error",
          code: "change-runtime-incompatible",
          message: inspection.message ?? `Native change ${name} requires a newer runtime`,
          path: path25.join(paths.changesDir, name, "change.yaml")
        });
        continue;
      }
      if (!options.repair) {
        findings.push({
          severity: "error",
          code: pending ? "schema-migration-incomplete" : "schema-migration-required",
          message: pending ? `Native schema migration ${pending.id} is incomplete for ${name}` : `Native change ${name} requires migration to the current schema`,
          path: pending ? file : path25.join(paths.changesDir, name, "change.yaml"),
          repair: "migrate"
        });
        continue;
      }
      await migrateNativeChange({ paths, name });
      findings.push({
        severity: "info",
        code: pending ? "schema-migration-recovered" : "schema-migrated",
        message: `Migrated Native change ${name} to the current schema`,
        path: path25.join(paths.changesDir, name, "change.yaml")
      });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      findings.push({
        severity: "error",
        code: "schema-migration-failed",
        message: `Native schema migration failed for ${name}: ${error.message}`,
        path: file
      });
    }
  }
  return findings;
}
async function inspectTransitionJournals(paths, options) {
  const findings = [];
  const names = options.name ? [options.name] : (await directoryEntries(paths.changesDir)).filter((entry2) => entry2.isDirectory() && !entry2.isSymbolicLink()).map((entry2) => entry2.name).sort();
  for (const name of names) {
    let journal;
    try {
      journal = await inspectPendingNativeTransition(paths, name);
    } catch (error) {
      if (error instanceof NativeTransitionMigrationRequiredError) continue;
      findings.push({
        severity: "error",
        code: "transition-invalid",
        message: `Native transition journal is invalid: ${error.message}`,
        path: nativeTransitionJournalFile(paths, name)
      });
      continue;
    }
    if (!journal) continue;
    if (options.repair && options.recoveryStrategy === "continue") {
      try {
        await continueNativeTransition(paths, name);
        findings.push({
          severity: "info",
          code: "transition-recovered",
          message: `Continued Native phase transition ${journal.id} for ${name}`,
          path: nativeTransitionJournalFile(paths, name)
        });
      } catch (error) {
        findings.push({
          severity: "error",
          code: "transition-recovery-failed",
          message: `Native transition recovery failed: ${error.message}`,
          path: nativeTransitionJournalFile(paths, name)
        });
      }
      continue;
    }
    findings.push({
      severity: "error",
      code: "transition-incomplete",
      message: options.repair && options.recoveryStrategy === "rollback" ? `Native phase transition ${journal.id} only supports deterministic continue recovery` : `Native phase transition ${journal.id} is incomplete for ${name}`,
      path: nativeTransitionJournalFile(paths, name),
      repair: "continue"
    });
  }
  return findings;
}
async function inspectCheckpointJournals(paths, options) {
  const findings = [];
  const names = options.name ? [options.name] : (await directoryEntries(paths.changesDir)).filter((entry2) => entry2.isDirectory() && !entry2.isSymbolicLink()).map((entry2) => entry2.name).sort();
  for (const name of names) {
    const file = nativeCheckpointJournalFile(paths, name);
    let journal;
    try {
      journal = await readNativeCheckpointJournal(paths, name);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      findings.push({
        severity: "error",
        code: "checkpoint-progress-invalid",
        message: `Native progress checkpoint journal is invalid: ${error.message}`,
        path: file
      });
      continue;
    }
    if (!journal) continue;
    if (!options.repair) {
      findings.push({
        severity: "error",
        code: "checkpoint-progress-incomplete",
        message: `Native progress checkpoint ${journal.id} is incomplete for ${name}`,
        path: file
      });
      continue;
    }
    try {
      await continueNativeCheckpoint(paths, name);
      findings.push({
        severity: "info",
        code: "checkpoint-progress-recovered",
        message: `Continued Native progress checkpoint ${journal.id} for ${name}`,
        path: file
      });
    } catch (error) {
      findings.push({
        severity: "error",
        code: "checkpoint-progress-recovery-failed",
        message: `Native progress checkpoint recovery failed: ${error.message}`,
        path: file
      });
    }
  }
  return findings;
}
async function doctorNativeProject(options) {
  const repair = options.repair ?? false;
  const findings = [];
  let paths = options.paths;
  let config;
  try {
    config = await readProjectConfig(paths.projectRoot);
  } catch (error) {
    const result2 = {
      healthy: false,
      findings: [
        {
          severity: "error",
          code: "config-invalid",
          message: `Comet project config is invalid: ${error.message}`,
          path: paths.configFile
        }
      ]
    };
    return result2;
  }
  if (config?.native.pending_root_move) {
    const pending = config.native.pending_root_move;
    const [fromPaths, toPaths] = await Promise.all([
      nativeProjectPaths(paths.projectRoot, pending.fromArtifactRoot),
      nativeProjectPaths(paths.projectRoot, pending.toArtifactRoot)
    ]);
    if (repair && options.recoveryStrategy) {
      try {
        const locksReady = await clearStaleRecoveryLocks(
          [
            path25.join(fromPaths.locksDir, "root-move.lock"),
            path25.join(toPaths.locksDir, "root-move.lock")
          ],
          findings
        );
        if (!locksReady) return { healthy: false, findings };
        const recovered = await recoverNativeRootMove({
          projectRoot: paths.projectRoot,
          strategy: options.recoveryStrategy
        });
        paths = await nativeProjectPaths(paths.projectRoot, recovered.config.native.artifact_root);
        findings.push({
          severity: "info",
          code: "root-move-recovered",
          message: `${options.recoveryStrategy === "continue" ? "Continued" : "Rolled back"} Native root move ${pending.id}`
        });
      } catch (error) {
        findings.push({
          severity: "error",
          code: "root-move-recovery-failed",
          message: `Native root recovery failed: ${error.message}`
        });
        return { healthy: false, findings };
      }
    } else {
      findings.push({
        severity: "error",
        code: "root-move-incomplete",
        message: `Native root move ${pending.id} is ${pending.stage}; inspect ${fromPaths.nativeRoot} and ${toPaths.nativeRoot}`,
        repair: options.recoveryStrategy ?? "continue"
      });
    }
  }
  const managedPathFindings = await inspectManagedPaths(paths);
  findings.push(...managedPathFindings);
  if (managedPathFindings.length > 0) return { healthy: false, findings };
  const transactions = await inspectTransactions(paths, {
    name: options.name,
    repair,
    recoveryStrategy: options.recoveryStrategy
  });
  findings.push(...transactions.findings);
  findings.push(...await inspectSchemaMigrations(paths, { name: options.name, repair }));
  findings.push(...await inspectTrajectoryTailRepairs(paths, { name: options.name, repair }));
  findings.push(
    ...await inspectTransitionJournals(paths, {
      name: options.name,
      repair,
      recoveryStrategy: options.recoveryStrategy
    })
  );
  findings.push(...await inspectCheckpointJournals(paths, { name: options.name, repair }));
  findings.push(...await inspectLocks(paths, repair, transactions.unfinished));
  findings.push(...await inspectSelection(paths, repair));
  findings.push(...await inspectChanges(paths, options.name));
  return {
    healthy: findings.every((finding) => finding.severity === "info"),
    findings
  };
}

// domains/comet-native/native-progress-checkpoint.ts
import { randomUUID as randomUUID10 } from "crypto";
function requiredText(value, label) {
  const normalized = redactNativeCredentialText(value).trim();
  if (normalized.length === 0 || normalized.length > 2e3) {
    throw new Error(`${label} must be between 1 and 2000 characters`);
  }
  return normalized;
}
function expectedRevisionValue(value) {
  if (value === void 0) return void 0;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Native expected revision must be a positive integer");
  }
  return value;
}
async function checkpointNativeChange(options) {
  const summary = requiredText(options.summary, "Checkpoint summary");
  const nextAction = requiredText(options.nextAction, "Checkpoint next action");
  const expectedRevision = expectedRevisionValue(options.expectedRevision);
  return withNativeMutationLock(
    options.paths,
    `checkpoint ${options.name}`,
    () => withNativeTransitionLock(
      options.paths,
      options.name,
      `checkpoint ${options.name}`,
      async () => {
        await settleNativeChangeJournalsLocked(options.paths, options.name);
        const state = await readNativeChange(options.paths, options.name);
        const manifest = await createNativeCheckpointManifest(
          options.paths,
          options.name,
          options.artifacts ?? []
        );
        const manifestHash = hashNativeCheckpointManifest(manifest);
        const inputHash = sha256Text(
          JSON.stringify({
            summary,
            nextAction,
            artifacts: manifest.artifacts
          })
        );
        const existing = await readNativeProgressCheckpoint(options.paths, options.name);
        if (existing?.inputHash === inputHash && existing.stateRevision === state.revision && existing.phase === state.phase) {
          if (expectedRevision !== void 0 && expectedRevision !== existing.previousRevision && expectedRevision !== state.revision) {
            throw new NativeChangeRevisionConflictError(
              state.name,
              expectedRevision,
              state.revision
            );
          }
          return {
            change: state,
            checkpoint: existing,
            idempotent: true,
            expectedRevision: expectedRevision ?? existing.previousRevision,
            previousRevision: existing.previousRevision,
            revision: state.revision,
            outcome: "idempotent",
            continuation: nativeContinuation({ state })
          };
        }
        if (expectedRevision !== void 0 && state.revision !== expectedRevision) {
          throw new NativeChangeRevisionConflictError(state.name, expectedRevision, state.revision);
        }
        const nextState = { ...state, revision: state.revision + 1 };
        const checkpoint = {
          schema: "comet.native.progress-checkpoint.v1",
          id: options.checkpointId?.() ?? randomUUID10(),
          change: state.name,
          phase: state.phase,
          previousRevision: state.revision,
          stateRevision: nextState.revision,
          summary,
          nextAction,
          inputHash,
          manifestHash,
          manifestRef: nativeCheckpointManifestRef(manifestHash),
          artifactCount: manifest.artifacts.length,
          createdAt: (options.now ?? /* @__PURE__ */ new Date()).toISOString()
        };
        const journal = await prepareNativeCheckpointJournal({
          paths: options.paths,
          previousState: state,
          nextState,
          checkpoint,
          manifest,
          now: options.now,
          checkpointId: () => checkpoint.id
        });
        await options.hooks?.afterPrepared?.(journal);
        const persisted = await continueNativeCheckpointLocked(
          options.paths,
          options.name,
          options.hooks
        );
        if (!persisted) throw new Error("Native checkpoint journal disappeared before completion");
        return {
          change: persisted.nextState,
          checkpoint: persisted.checkpoint,
          idempotent: false,
          expectedRevision: expectedRevision ?? persisted.checkpoint.previousRevision,
          previousRevision: persisted.checkpoint.previousRevision,
          revision: persisted.nextState.revision,
          outcome: "recorded",
          continuation: nativeContinuation({ state: persisted.nextState })
        };
      }
    )
  );
}

// domains/comet-native/native-specs.ts
import { promises as fs22 } from "fs";
import path26 from "path";
async function optionalHash2(file) {
  try {
    return await sha256File(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function proposedCapabilities(paths, name) {
  const specsDir = path26.join(nativeChangeDir(paths, name), "specs");
  let entries;
  try {
    entries = await fs22.readdir(specsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const capabilities = [];
  for (const entry2 of entries) {
    if (entry2.isSymbolicLink()) {
      throw new Error(`Proposed spec capability must not be a symbolic link: ${entry2.name}`);
    }
    if (!entry2.isDirectory()) continue;
    assertNativeName(entry2.name);
    const source = path26.join(specsDir, entry2.name, "spec.md");
    await resolveContainedNativePath(paths.nativeRoot, source);
    let stat;
    try {
      stat = await fs22.lstat(source);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Proposed spec must be a regular file: ${entry2.name}`);
    }
    capabilities.push(entry2.name);
  }
  return capabilities.sort();
}
async function reconcileNativeSpecChanges(paths, state) {
  const previous = new Map(state.spec_changes.map((change) => [change.capability, change]));
  const proposed = await proposedCapabilities(paths, state.name);
  const changes = [];
  for (const capability of proposed) {
    const existing = previous.get(capability);
    if (existing?.operation === "remove") {
      throw new Error(`Capability ${capability} has both a proposed spec and a remove intent`);
    }
    if (existing) {
      changes.push({
        ...existing,
        source: `specs/${capability}/spec.md`
      });
      continue;
    }
    const canonical = canonicalSpecPath(paths, capability);
    await resolveContainedNativePath(paths.nativeRoot, canonical);
    const baseHash = await optionalHash2(canonical);
    changes.push({
      capability,
      operation: baseHash === null ? "create" : "replace",
      source: `specs/${capability}/spec.md`,
      base_hash: baseHash
    });
  }
  for (const change of state.spec_changes) {
    if (change.operation === "remove" && !proposed.includes(change.capability)) {
      changes.push(change);
    }
  }
  return changes.sort((left, right) => left.capability.localeCompare(right.capability));
}
async function refreshNativeSpecChanges(paths, state) {
  const proposed = await proposedCapabilities(paths, state.name);
  const changes = [];
  for (const capability of proposed) {
    const existing = state.spec_changes.find((change) => change.capability === capability);
    if (existing?.operation === "remove") {
      throw new Error(`Capability ${capability} has both a proposed spec and a remove intent`);
    }
    const canonical = canonicalSpecPath(paths, capability);
    await resolveContainedNativePath(paths.nativeRoot, canonical);
    const baseHash = await optionalHash2(canonical);
    changes.push({
      capability,
      operation: baseHash === null ? "create" : "replace",
      source: `specs/${capability}/spec.md`,
      base_hash: baseHash
    });
  }
  for (const change of state.spec_changes) {
    if (change.operation !== "remove" || proposed.includes(change.capability)) continue;
    const canonical = canonicalSpecPath(paths, change.capability);
    await resolveContainedNativePath(paths.nativeRoot, canonical);
    const baseHash = await optionalHash2(canonical);
    if (baseHash !== null) {
      changes.push({ ...change, base_hash: baseHash });
    }
  }
  return changes.sort((left, right) => left.capability.localeCompare(right.capability));
}
async function rebaseNativeSpecChanges(options) {
  assertNativeName(options.name);
  if (options.summary.trim().length === 0) throw new Error("Spec rebase requires a summary");
  return withNativeMutationLock(
    options.paths,
    `rebase specs for ${options.name}`,
    () => withNativeTransitionLock(
      options.paths,
      options.name,
      `rebase specs for ${options.name}`,
      async () => {
        await settleNativeChangeJournalsLocked(options.paths, options.name);
        const state = await readNativeChange(options.paths, options.name);
        if (state.phase === "shape") {
          throw new Error("Shape spec metadata is refreshed by the next command");
        }
        if (state.archived) throw new Error(`Native change ${state.name} is already archived`);
        const changeDir = nativeChangeDir(options.paths, options.name);
        const run = await readRunStateAt(changeDir, NATIVE_RUN_STORAGE);
        if (!run || run.runId !== state.run_id || run.currentStep !== state.phase || run.pending) {
          throw new Error(`Native Run state is missing or inconsistent for ${state.name}`);
        }
        const specChanges = await refreshNativeSpecChanges(options.paths, state);
        const nextState = {
          ...state,
          revision: state.revision + 1,
          phase: "build",
          spec_changes: specChanges,
          verification_result: "pending",
          verification_report: null
        };
        const nextRun = {
          ...run,
          currentStep: "build",
          iteration: run.iteration + 1,
          pending: null,
          status: "running"
        };
        const evidenceHash2 = sha256Text(`spec-rebase:${state.name}:${options.summary}`);
        await prepareNativeTransition({
          paths: options.paths,
          previousState: state,
          nextState,
          previousRun: run,
          nextRun,
          evidenceHash: evidenceHash2,
          eventData: {
            previousPhase: state.phase,
            nextPhase: "build",
            evidenceHash: evidenceHash2,
            summary: options.summary,
            reason: "spec-rebase"
          },
          now: options.now,
          transitionId: options.transitionId
        });
        const rebased = await continueNativeTransitionLocked(options.paths, options.name);
        if (!rebased) throw new Error("Native spec rebase journal disappeared before completion");
        return rebased;
      }
    )
  );
}
async function markNativeSpecRemoval(paths, name, capability) {
  assertNativeName(name);
  assertNativeName(capability);
  return withNativeMutationLock(
    paths,
    `remove spec ${capability} from ${name}`,
    () => withNativeTransitionLock(paths, name, `remove spec ${capability} from ${name}`, async () => {
      await settleNativeChangeJournalsLocked(paths, name);
      return markNativeSpecRemovalLocked(paths, name, capability);
    })
  );
}
async function markNativeSpecRemovalLocked(paths, name, capability) {
  const state = await readNativeChange(paths, name);
  if (state.phase === "archive" || state.archived) {
    throw new Error(`Native change ${name} no longer accepts spec changes`);
  }
  const proposed = await proposedCapabilities(paths, name);
  if (proposed.includes(capability)) {
    throw new Error(`Capability ${capability} has both a proposed spec and a remove intent`);
  }
  const previous = state.spec_changes.find((change) => change.capability === capability);
  if (previous?.operation === "remove") return state;
  const canonical = canonicalSpecPath(paths, capability);
  await resolveContainedNativePath(paths.nativeRoot, canonical);
  const baseHash = await optionalHash2(canonical);
  if (baseHash === null) throw new Error(`Canonical spec is missing: ${capability}`);
  const updated = {
    ...state,
    spec_changes: [
      ...state.spec_changes.filter((change) => change.capability !== capability),
      { capability, operation: "remove", base_hash: baseHash }
    ].sort((left, right) => left.capability.localeCompare(right.capability))
  };
  await compareAndSwapNativeChangeLocked(paths, updated, state.revision);
  return updated;
}
async function readNativeProposedSpecs(paths, name) {
  const changeDir = nativeChangeDir(paths, name);
  const result2 = {};
  for (const capability of await proposedCapabilities(paths, name)) {
    result2[capability] = await fs22.readFile(
      path26.join(changeDir, "specs", capability, "spec.md"),
      "utf8"
    );
  }
  return result2;
}

// domains/comet-native/native-transitions.ts
import { randomUUID as randomUUID11 } from "crypto";

// domains/comet-native/native-guards.ts
import { promises as fs23 } from "fs";
import path27 from "path";
function validation(findings) {
  return { valid: findings.length === 0, findings };
}
async function validateBuildArtifacts(paths, evidence) {
  const findings = [];
  if ((evidence.noCodeReason ?? "").trim().length > 0) return findings;
  if (!evidence.artifacts || evidence.artifacts.length === 0) {
    return [
      {
        code: "build-evidence-missing",
        message: "Build requires an artifact reference or an explicit no-code reason"
      }
    ];
  }
  for (const artifact of evidence.artifacts) {
    if (path27.isAbsolute(artifact) || artifact.split(/[\\/]/u).includes("..") || /^(?:[A-Za-z]:|~|[\\/])/u.test(artifact)) {
      findings.push({
        code: "build-artifact-unsafe",
        message: `Unsafe build artifact: ${artifact}`
      });
      continue;
    }
    const target = path27.resolve(paths.projectRoot, ...artifact.split(/[\\/]/u));
    if (!isInsidePath(paths.projectRoot, target)) {
      findings.push({
        code: "build-artifact-unsafe",
        message: `Unsafe build artifact: ${artifact}`
      });
      continue;
    }
    try {
      await fs23.access(target);
    } catch {
      findings.push({
        code: "build-artifact-missing",
        message: `Build artifact does not exist: ${artifact}`,
        path: artifact
      });
    }
  }
  return findings;
}
async function inspectNativeGuard(options) {
  const findings = [];
  const changeDir = nativeChangeDir(options.paths, options.state.name);
  if (options.evidence.summary.trim().length === 0) {
    findings.push({
      code: "transition-summary-missing",
      message: "Phase transition requires a summary"
    });
  }
  if (options.evidence.confirmed && options.state.phase !== "shape" && options.state.phase !== "build") {
    findings.push({
      code: "confirmation-not-shape",
      message: "Explicit confirmation is only valid while leaving Shape or Build"
    });
  }
  findings.push(...await inspectNativeRunConsistency(options.paths, options.state));
  if (options.state.phase === "shape") {
    const brief = await validateNativeBrief(changeDir, options.state.brief);
    const specs = await validateNativeSpecChanges(options.paths, options.state);
    findings.push(...brief.findings, ...specs.findings);
  } else if (options.state.phase === "build") {
    findings.push(
      ...(await validateNativeBrief(changeDir, options.state.brief)).findings,
      ...(await validateNativeSpecChanges(options.paths, options.state)).findings
    );
    findings.push(...await validateBuildArtifacts(options.paths, options.evidence));
  } else if (options.state.phase === "verify") {
    const report = options.evidence.verificationReport ?? options.state.verification_report;
    if (!report) {
      findings.push({
        code: "verification-report-missing",
        message: "Verify requires a report path"
      });
    } else {
      findings.push(...(await validateNativeVerification(changeDir, report)).findings);
    }
    if (!options.evidence.verificationResult) {
      findings.push({
        code: "verification-result-missing",
        message: "Verify requires pass or fail"
      });
    }
    findings.push(...(await validateNativeSpecChanges(options.paths, options.state)).findings);
  } else {
    findings.push({
      code: "archive-command-required",
      message: "Use comet native archive for the Archive phase"
    });
  }
  return validation(findings);
}

// domains/comet-native/native-transitions.ts
function evidenceHash(evidence) {
  return sha256Text(
    JSON.stringify({
      summary: evidence.summary,
      confirmed: evidence.confirmed ?? false,
      artifacts: [...evidence.artifacts ?? []].sort(),
      noCodeReason: evidence.noCodeReason ?? null,
      verificationResult: evidence.verificationResult ?? null,
      verificationReport: evidence.verificationReport ?? null
    })
  );
}
async function advanceNativeChange(options) {
  return withNativeMutationLock(
    options.paths,
    `advance ${options.name}`,
    () => withNativeTransitionLock(
      options.paths,
      options.name,
      `advance ${options.name}`,
      () => advanceNativeChangeLocked(options)
    )
  );
}
async function advanceNativeChangeLocked(options) {
  await settleNativeChangeJournalsLocked(options.paths, options.name);
  const state = await readNativeChange(options.paths, options.name);
  const previousPhase = state.phase;
  const changeDir = nativeChangeDir(options.paths, options.name);
  const hash = evidenceHash(options.evidence);
  const existingRun = await readRunStateAt(changeDir, NATIVE_RUN_STORAGE);
  if (existingRun) {
    const trajectory = await readTrajectory(changeDir, existingRun.trajectoryRef);
    const last = trajectory.at(-1);
    if (last?.type === "state_transitioned" && last.data.evidenceHash === hash && last.data.nextPhase === state.phase) {
      return {
        change: state,
        previousPhase: last.data.previousPhase ?? state.phase,
        next: "auto",
        nextCommand: state.phase === "archive" ? `comet native archive ${state.name}` : null,
        findings: [],
        continuation: nativeContinuation({
          state,
          archiveReady: state.phase === "archive" && state.verification_result === "pass"
        })
      };
    }
  }
  const candidate = {
    ...state,
    spec_changes: await reconcileNativeSpecChanges(options.paths, state)
  };
  const guard = await inspectNativeGuard({
    paths: options.paths,
    state: candidate,
    evidence: options.evidence
  });
  if (!guard.valid) {
    const findings = structureNativeFindings({
      paths: options.paths,
      state,
      findings: guard.findings
    });
    return {
      change: state,
      previousPhase,
      next: "manual",
      nextCommand: null,
      findings,
      continuation: nativeContinuation({ state, findings })
    };
  }
  let run = existingRun;
  if (!run) {
    if (state.run_id !== null || state.phase !== "shape") {
      throw new Error("Native Run state is missing or inconsistent");
    }
    run = startRunWithStorage(
      NATIVE_RUNTIME_PACKAGE,
      options.runId?.() ?? randomUUID11(),
      NATIVE_RUNTIME_HASH,
      NATIVE_RUN_STORAGE
    );
  }
  if (run.currentStep !== state.phase) {
    throw new Error(`Native Run step ${run.currentStep ?? "(none)"} does not match ${state.phase}`);
  }
  const decision = decideWithResolver(
    NATIVE_RUNTIME_PACKAGE,
    run,
    /* @__PURE__ */ new Set(),
    nativePhaseResolver,
    void 0
  );
  if (!decision.action) throw new Error(decision.reason ?? "Native runtime produced no action");
  const advanced = recordOutcomeWithResolver(
    NATIVE_RUNTIME_PACKAGE,
    decision.state,
    {
      actionId: decision.action.id,
      status: "succeeded",
      summary: options.evidence.summary,
      state: options.evidence.verificationResult ? { verification_result: options.evidence.verificationResult } : void 0
    },
    nativePhaseResolver,
    void 0
  );
  if (!advanced.currentStep) throw new Error("Archive completion must use the archive command");
  const updated = {
    ...candidate,
    revision: state.revision + 1,
    phase: advanced.currentStep,
    approval: options.evidence.confirmed ? "confirmed" : state.phase === "shape" && state.approval === null ? "implicit" : state.approval,
    run_id: run.runId,
    ...state.phase === "build" ? { verification_result: "pending" } : {},
    ...state.phase === "verify" ? {
      verification_result: options.evidence.verificationResult,
      verification_report: options.evidence.verificationReport ?? state.verification_report
    } : {}
  };
  const eventData = {
    previousPhase,
    nextPhase: updated.phase,
    evidenceHash: hash,
    summary: options.evidence.summary,
    artifacts: options.evidence.artifacts ?? [],
    noCodeReason: options.evidence.noCodeReason ?? null,
    verificationResult: options.evidence.verificationResult ?? null
  };
  const journal = await prepareNativeTransition({
    paths: options.paths,
    previousState: state,
    nextState: updated,
    previousRun: existingRun,
    nextRun: advanced,
    evidenceHash: hash,
    eventData,
    now: options.now,
    transitionId: options.transitionId
  });
  await options.hooks?.afterPrepared?.(journal);
  const persisted = await continueNativeTransitionLocked(
    options.paths,
    options.name,
    options.hooks
  );
  if (!persisted) throw new Error("Native transition journal disappeared before completion");
  return {
    change: persisted,
    previousPhase,
    next: "auto",
    nextCommand: persisted.phase === "archive" ? `comet native archive ${persisted.name}` : null,
    findings: [],
    continuation: nativeContinuation({
      state: persisted,
      archiveReady: persisted.phase === "archive" && persisted.verification_result === "pass"
    })
  };
}

// domains/comet-native/native-cli.ts
var NativeUsageError = class extends Error {
};
var USAGE = `Usage: comet native <command> [options]

Commands:
  init [--root <artifact-root>] [--language en|zh-CN]
  root show
  root move <artifact-root>
  new <change-name> [--language en|zh-CN]
  spec remove <change-name> <capability>
  spec rebase <change-name> --summary <text>
  list
  show <change-name>
  status [<change-name>]
  select <change-name>
  checkpoint <change-name> --summary <text> --next-action <text> [--artifact <project-relative>] [--expect-revision <n>]
  next <change-name> --summary <text> [--confirmed] [--artifact <path>] [--no-code-reason <text>] [--result pass|fail] [--report <path>]
  archive <change-name>
  doctor [<change-name>] [--repair] [--strategy continue|rollback]
`;
function takeFlag(args, name) {
  const indexes = args.flatMap((value, index) => value === name ? [index] : []);
  if (indexes.length > 1) throw new NativeUsageError(`${name} may only be provided once`);
  if (indexes.length === 0) return false;
  args.splice(indexes[0], 1);
  return true;
}
function takeOption(args, name) {
  const indexes = args.flatMap((value2, index2) => value2 === name ? [index2] : []);
  if (indexes.length > 1) throw new NativeUsageError(`${name} may only be provided once`);
  if (indexes.length === 0) return void 0;
  const index = indexes[0];
  const value = args[index + 1];
  if (value === void 0 || value.startsWith("--")) {
    throw new NativeUsageError(`${name} requires a value`);
  }
  args.splice(index, 2);
  return value;
}
function takeMany(args, name) {
  const values = [];
  for (let index = 0; index < args.length; ) {
    if (args[index] !== name) {
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (value === void 0 || value.startsWith("--")) {
      throw new NativeUsageError(`${name} requires a value`);
    }
    values.push(value);
    args.splice(index, 2);
  }
  return values;
}
function assertNoArguments(args) {
  if (args.length > 0) throw new NativeUsageError(`Unexpected argument: ${args[0]}`);
}
function requiredPositional(args, label) {
  const value = args.shift();
  if (!value || value.startsWith("--")) throw new NativeUsageError(`${label} is required`);
  return value;
}
function languageOption(args) {
  const language = takeOption(args, "--language") ?? "en";
  if (language !== "en" && language !== "zh-CN") {
    throw new NativeUsageError("--language must be en or zh-CN");
  }
  return language;
}
function revisionOption(args) {
  const value = takeOption(args, "--expect-revision");
  if (value === void 0) return void 0;
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new NativeUsageError("--expect-revision must be a positive integer");
  }
  return Number(value);
}
async function projectRootFrom(explicit) {
  return explicit ? path28.resolve(explicit) : discoverNativeProject(process.cwd());
}
async function configuredPaths(projectRoot) {
  const resolved = await resolveNativeProject({
    startPath: projectRoot,
    allowMissingConfig: false
  });
  return { config: resolved.config, paths: resolved.paths };
}
async function doctorPaths(projectRoot) {
  const config = await readProjectConfig(projectRoot);
  return nativeProjectPaths(projectRoot, config?.native.artifact_root ?? ".");
}
function success(command, data, text) {
  return { command, exitCode: 0, data, text: text ?? JSON.stringify(data, null, 2) + "\n" };
}
async function dispatch(rawArgs, explicitProjectRoot) {
  if (rawArgs.length === 0 || rawArgs[0] === "--help" || rawArgs[0] === "help") {
    return { command: rawArgs[0] ?? null, exitCode: 0, data: { usage: USAGE }, text: USAGE };
  }
  const command = rawArgs.shift();
  const projectRoot = await projectRootFrom(explicitProjectRoot);
  if (command === "init") {
    const requestedRoot = takeOption(rawArgs, "--root");
    const language = languageOption(rawArgs);
    assertNoArguments(rawArgs);
    const existing = await readProjectConfig(projectRoot);
    if (existing?.native.pending_root_move) {
      throw new Error(`Native root move ${existing.native.pending_root_move.id} is incomplete`);
    }
    const artifactRoot = normalizeArtifactRootRef(
      requestedRoot ?? existing?.native.artifact_root ?? "."
    );
    if (existing && requestedRoot && existing.native.artifact_root !== artifactRoot) {
      throw new Error(
        `Configured Native artifact root is ${existing.native.artifact_root}; refusing conflicting root ${artifactRoot}`
      );
    }
    const config = existing ?? defaultProjectConfig(artifactRoot);
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
    await ensureNativeDirectories(paths);
    if (!existing) await writeProjectConfig(projectRoot, config);
    return success(
      "init",
      {
        projectRoot,
        artifactRoot: config.native.artifact_root,
        nativeRoot: paths.nativeRoot,
        language
      },
      `Initialized Comet Native at ${paths.nativeRoot}
`
    );
  }
  if (command === "root") {
    const subcommand = requiredPositional(rawArgs, "root subcommand");
    if (subcommand === "show") {
      assertNoArguments(rawArgs);
      const config = await readProjectConfig(projectRoot);
      if (!config) throw new Error("comet.config.yaml was not found");
      const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
      return success("root show", {
        projectRoot,
        artifactRoot: config.native.artifact_root,
        nativeRoot: paths.nativeRoot,
        pendingRootMove: config.native.pending_root_move ?? null
      });
    }
    if (subcommand === "move") {
      const target = requiredPositional(rawArgs, "artifact root");
      assertNoArguments(rawArgs);
      const result2 = await moveNativeRoot({ projectRoot, toArtifactRoot: target });
      return success("root move", result2, `Moved Comet Native to ${result2.toNativeRoot}
`);
    }
    throw new NativeUsageError(`Unknown root command: ${subcommand}`);
  }
  if (command === "new") {
    const name = requiredPositional(rawArgs, "change name");
    const language = languageOption(rawArgs);
    assertNoArguments(rawArgs);
    let config = await readProjectConfig(projectRoot);
    const shouldWriteConfig = config === null;
    if (!config) {
      config = defaultProjectConfig(".");
    }
    if (config.native.pending_root_move) {
      throw new Error(`Native root move ${config.native.pending_root_move.id} is incomplete`);
    }
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
    await ensureNativeDirectories(paths);
    const state = await createNativeChange({ paths, name, language });
    if (shouldWriteConfig) await writeProjectConfig(projectRoot, config);
    const status = await inspectNativeStatus(paths, state.name);
    return success(
      "new",
      { ...state, continuation: status.continuation },
      `Created Native change ${state.name}
`
    );
  }
  if (command === "spec") {
    const subcommand = requiredPositional(rawArgs, "spec subcommand");
    if (subcommand === "remove") {
      const name = requiredPositional(rawArgs, "change name");
      const capability = requiredPositional(rawArgs, "capability");
      assertNoArguments(rawArgs);
      const { paths } = await configuredPaths(projectRoot);
      const state = await markNativeSpecRemoval(paths, name, capability);
      const status = await inspectNativeStatus(paths, state.name);
      return success(
        "spec remove",
        { ...state, continuation: status.continuation },
        `Marked Native capability ${capability} for removal in ${name}
`
      );
    }
    if (subcommand === "rebase") {
      const name = requiredPositional(rawArgs, "change name");
      const summary = takeOption(rawArgs, "--summary");
      if (!summary) throw new NativeUsageError("--summary is required");
      assertNoArguments(rawArgs);
      const { paths } = await configuredPaths(projectRoot);
      const state = await rebaseNativeSpecChanges({ paths, name, summary });
      const status = await inspectNativeStatus(paths, state.name);
      return success(
        "spec rebase",
        { ...state, continuation: status.continuation },
        `Rebased Native specs for ${name}
`
      );
    }
    throw new NativeUsageError(`Unknown spec command: ${subcommand}`);
  }
  if (command === "list") {
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const changes = await listNativeChanges(paths);
    return success("list", changes);
  }
  if (command === "show") {
    const name = requiredPositional(rawArgs, "change name");
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const inspection = await inspectNativeChange(paths, name);
    if (inspection.status === "migration-required") {
      return success("show", {
        name,
        schema: inspection.schema,
        minimumRuntimeVersion: inspection.minimumRuntimeVersion,
        migrationRequired: true,
        message: inspection.message
      });
    }
    if (inspection.status !== "current" || !inspection.state) {
      throw new NativeRuntimeCompatibilityError(
        inspection.schema,
        inspection.minimumRuntimeVersion
      );
    }
    const state = inspection.state;
    const changeDir = nativeChangeDir(paths, name);
    const proposedSpecs = await readNativeProposedSpecs(paths, name);
    return success("show", {
      state,
      brief: await fs24.readFile(path28.join(changeDir, state.brief), "utf8"),
      proposedSpecs
    });
  }
  if (command === "status") {
    const details = takeFlag(rawArgs, "--details");
    const name = rawArgs[0]?.startsWith("--") ? void 0 : rawArgs.shift();
    if (details && !name) throw new NativeUsageError("status --details requires a change name");
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const data = name ? await inspectNativeStatus(paths, name, { details }) : await listNativeStatus(paths);
    return success("status", data);
  }
  if (command === "select") {
    const name = requiredPositional(rawArgs, "change name");
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    await selectNativeChange(paths, name);
    const status = await inspectNativeStatus(paths, name);
    return success(
      "select",
      { selected: name, continuation: status.continuation },
      `Selected Native change ${name}
`
    );
  }
  if (command === "checkpoint") {
    const name = requiredPositional(rawArgs, "change name");
    const summary = takeOption(rawArgs, "--summary");
    if (!summary) throw new NativeUsageError("--summary is required");
    const nextAction = takeOption(rawArgs, "--next-action");
    if (!nextAction) throw new NativeUsageError("--next-action is required");
    const artifacts = takeMany(rawArgs, "--artifact");
    const expectedRevision = revisionOption(rawArgs);
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const result2 = await checkpointNativeChange({
      paths,
      name,
      summary,
      nextAction,
      artifacts,
      expectedRevision
    });
    const status = await inspectNativeStatus(paths, name);
    const manifestRef = path28.relative(
      paths.projectRoot,
      path28.join(nativeChangeDir(paths, name), ...result2.checkpoint.manifestRef.split("/"))
    ).replaceAll("\\", "/");
    return success("checkpoint", {
      ...result2,
      checkpoint: { ...result2.checkpoint, manifestRef },
      continuation: status.continuation
    });
  }
  if (command === "next") {
    const name = requiredPositional(rawArgs, "change name");
    const summary = takeOption(rawArgs, "--summary");
    if (!summary) throw new NativeUsageError("--summary is required");
    const confirmed = takeFlag(rawArgs, "--confirmed");
    const artifacts = takeMany(rawArgs, "--artifact");
    const noCodeReason = takeOption(rawArgs, "--no-code-reason");
    const verificationResult = takeOption(rawArgs, "--result");
    const verificationReport = takeOption(rawArgs, "--report");
    if (verificationResult !== void 0 && verificationResult !== "pass" && verificationResult !== "fail") {
      throw new NativeUsageError("--result must be pass or fail");
    }
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const evidence = {
      summary,
      ...confirmed ? { confirmed: true } : {},
      ...artifacts.length > 0 ? { artifacts } : {},
      ...noCodeReason ? { noCodeReason } : {},
      ...verificationResult ? { verificationResult } : {},
      ...verificationReport ? { verificationReport } : {}
    };
    const result2 = await advanceNativeChange({ paths, name, evidence });
    if (result2.next === "manual") {
      return {
        command: "next",
        exitCode: 65,
        data: result2,
        error: {
          code: "invalid-data",
          message: result2.findings[0]?.message ?? "Native phase guard failed"
        }
      };
    }
    const status = await inspectNativeStatus(paths, name);
    return success("next", { ...result2, continuation: status.continuation });
  }
  if (command === "archive") {
    const name = requiredPositional(rawArgs, "change name");
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const state = await readNativeChange(paths, name);
    const result2 = await archiveNativeChange({ paths, name });
    return success(
      "archive",
      { ...result2, continuation: nativeContinuation({ state, done: true }) },
      `Archived Native change ${name} to ${result2.archiveDir}
`
    );
  }
  if (command === "doctor") {
    const repair = takeFlag(rawArgs, "--repair");
    const recoveryStrategy = takeOption(rawArgs, "--strategy");
    if (recoveryStrategy !== void 0 && recoveryStrategy !== "continue" && recoveryStrategy !== "rollback") {
      throw new NativeUsageError("--strategy must be continue or rollback");
    }
    const name = rawArgs[0]?.startsWith("--") ? void 0 : rawArgs.shift();
    assertNoArguments(rawArgs);
    const paths = await doctorPaths(projectRoot);
    const result2 = await doctorNativeProject({
      paths,
      ...name ? { name } : {},
      repair,
      ...recoveryStrategy ? { recoveryStrategy } : {}
    });
    return result2.healthy ? success("doctor", result2) : {
      command: "doctor",
      exitCode: 65,
      data: result2,
      error: { code: "invalid-data", message: "Native project needs attention" }
    };
  }
  throw new NativeUsageError(`Unknown Native command: ${command}`);
}
function errorResult(command, error) {
  if (error instanceof NativeUsageError) {
    return {
      command,
      exitCode: 64,
      error: { code: "usage", message: error.message }
    };
  }
  if (error instanceof NativeSpecConflictError) {
    return {
      command,
      exitCode: 73,
      data: {
        capability: error.capability,
        expectedHash: error.expectedHash,
        actualHash: error.actualHash,
        canonicalPath: error.canonicalPath
      },
      error: { code: "conflict", message: error.message }
    };
  }
  if (error instanceof NativeChangeRevisionConflictError) {
    return {
      command,
      exitCode: 73,
      data: {
        change: error.change,
        expectedRevision: error.expectedRevision,
        actualRevision: error.actualRevision,
        outcome: "revision-conflict"
      },
      error: { code: "conflict", message: error.message }
    };
  }
  if (error instanceof Error) {
    const systemCode = error.code;
    if (systemCode && (/* @__PURE__ */ new Set(["EACCES", "EPERM", "EIO", "EMFILE", "ENFILE", "ENOSPC", "EROFS"])).has(systemCode)) {
      return {
        command,
        exitCode: 70,
        error: { code: "internal", message: error.message }
      };
    }
    const conflict = /\b(lock|transaction|conflict|occupied|incomplete|recovery)\b/iu.test(
      error.message
    );
    return {
      command,
      exitCode: conflict ? 73 : 65,
      error: { code: conflict ? "conflict" : "invalid-data", message: error.message }
    };
  }
  return {
    command,
    exitCode: 70,
    error: { code: "internal", message: String(error) }
  };
}
function render(result2, json) {
  if (json) {
    return {
      exitCode: result2.exitCode,
      stdout: JSON.stringify({
        command: result2.command,
        exitCode: result2.exitCode,
        ...result2.data === void 0 ? {} : { data: result2.data },
        ...result2.error === void 0 ? {} : { error: result2.error }
      }) + "\n"
    };
  }
  if (result2.error) {
    return { exitCode: result2.exitCode, stderr: result2.error.message };
  }
  return { exitCode: result2.exitCode, stdout: result2.text };
}
async function runNativeCli(argv) {
  const args = [...argv];
  const json = args.includes("--json");
  let explicitProjectRoot;
  let command = args[0] ?? null;
  try {
    takeFlag(args, "--json");
    explicitProjectRoot = takeOption(args, "--project-root");
    command = args[0] ?? null;
    return render(await dispatch(args, explicitProjectRoot), json);
  } catch (error) {
    return render(errorResult(command, error), json);
  }
}

// domains/comet-native/native-cli-entry.ts
async function main(argv = process.argv.slice(2)) {
  const result2 = await runNativeCli(argv);
  if (result2.stdout) process.stdout.write(result2.stdout);
  if (result2.stderr) {
    process.stderr.write(result2.stderr + (result2.stderr.endsWith("\n") ? "" : "\n"));
  }
  return result2.exitCode;
}
var entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
export {
  main
};
