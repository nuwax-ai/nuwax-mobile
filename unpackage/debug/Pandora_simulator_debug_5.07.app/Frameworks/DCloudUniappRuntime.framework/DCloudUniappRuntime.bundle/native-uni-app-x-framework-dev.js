//create page move to $(ProjectDir)/HBuilder/HBuilder/Bundle/apps/__UNI__HelloApp/www/bundle.js

/*test framework*/
/*Todo*/
var jsId = 0;
function getId(tag){
    return tag + (jsId++)
}

function TestElement(type, style, atts){
    this.nodeId = getId("doc");
    this.pageId = null;
    this.type = type;
    this.style = style;
    this.atts = atts;
}

TestElement.prototype.appendChild = function(child){
    nativeDocument.addElement(this.pageId, this.nodeId, child.nodeId, "", child.type, child.style, child.atts);
}
TestElement.prototype.insertBefore = function(child, anchor){
    nativeDocument.addElement(this.pageId, this.nodeId, child.nodeId, anchor.nodeId, child.type, child.style, child.atts);
}

TestElement.prototype.removeChild = function(child){
    nativeDocument.removeChild(this.pageId, this.nodeId, child.nodeId);
}

TestElement.prototype.addEventListener = function(event, callback){
    nativeDocument.addEventListener(this.pageId, this.nodeId, event, callback);
}

TestElement.prototype.updateAttrs = function(atts){
    nativeDocument.updateAttrs(this.pageId, this.nodeId, atts);
}

TestElement.prototype.updateStyle = function(atts){
    nativeDocument.updateStyle(this.pageId, this.nodeId, atts);
    // Native.updateStyle(this.pageId, this.nodeId, atts);
}

TestElement.prototype.getElement = function(){
    return nativeDocument.getElement(this.pageId, this.nodeId);
}

TestElement.prototype.getDrawableContext = function(){
    return nativeDocument.getDrawableContext(this.pageId, this.nodeId);
}

TestElement.prototype.getBoundingClientRect = function(){
    return nativeDocument.getBoundingClientRect(this.pageId, this.nodeId);
}

TestElement.prototype.waitNativeRender = function(callback){
    return nativeDocument.waitNativeRender(this.pageId, callback);
}

function TestDocument(pageId, type, style, atts){
    this.pageId = pageId
    this.nodeId = "root"
    this.nodes = []
    nativePage.createDocument(this.pageId, this.nodeId, type, style, atts);
}
TestDocument.prototype = TestElement.prototype;
TestDocument.prototype.createElement = function(type, style, atts){
    var ele = new TestElement(type, style, atts);
    ele.pageId = this.pageId;
    this.nodes[ele.nodeId] = ele;
    return ele;
}


function TestPage(url, style){
    this.pageId = getId("page");
    this.url = url;
    this.style = style;
    this.document = new TestDocument(this.pageId,"view", {}, {});
    nativePage.create(this.pageId, this.url,style);
}

TestPage.prototype.show = function(style){
    //nativePage.render(this.pageId);
    nativePage.show(this.pageId, style);
}

TestPage.prototype.close = function(style){
    nativePage.close(this.pageId,style);
}

TestPage.prototype.render = function(){
    nativePage.render(this.pageId);
}



TestPage.prototype.createDocument = function(){
    if (this.document == null){
        this.document = new TestDocument(this.pageId,"view", {}, {});
    }
    return this.document;
}

TestPage.prototype.addEventListener = function(event, callback){
    nativePage.addEventListener(this.pageId, event, callback);
}

TestPage.prototype.removeEventListener = function(event, callback){
    nativePage.removeEventListener(this.pageId, event, callback);
}

var TestCustomPages = [];

function TestRoute(){
    this.pages = {}
    this.topPage = null
    nativeApp.addEventListener("back", ()=>{
        this.topPage.close({animationType:"pop-out"});
        for ( key in this.pages){
            if ( this.pages[key] == this.topPage ){
                delete this.pages[key]
                break
            }
        }
    })
}

TestRoute.prototype.navigateTo = function(name, option, style){
    var page = this.pages[name]
    if ( page == null ){
        page = new TestPage( "/main", option);
        this.pages[name] = page;
       // setTimeout(function(){
            TestCustomPages[name](page)
        //})
        page.addEventListener("onUnload", (event)=>{
            
        });
    }
    page.show(style)
    this.topPage = page
}

var route = new TestRoute()
//create page move to $(ProjectDir)/HBuilder/HBuilder/Bundle/apps/__UNI__HelloApp/www/index.js
