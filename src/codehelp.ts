import { Hover, HoverProvider, Disposable } from 'vscode';
import { Position, TextDocument, CancellationToken, MarkdownString, Range, CompletionItemKind } from 'vscode';
import { CompletionItemProvider, CompletionContext, ProviderResult, CompletionItem, CompletionList, window } from 'vscode';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { readFileSync } from 'fs';
import * as vscode from 'vscode';

export enum CodeHelpDetailLevel {
    OFF = 0
    , MINIMUM = 1
    , NO_EXAMPLES_NO_LINKS = 2
    , FULL = 3
}

enum SonicPiTypeDescription {
    UNKNOWN
    , ANY
    , RATIONAL_PATTERN
    , CONTROL_PATTERN
    , TIME_PATTERN
}

class SonicPiParameterDescription {
    constructor(
        public readonly name:string
        , public readonly help:MarkdownString
        , public readonly editable?:boolean
        , public readonly type?:SonicPiTypeDescription
    ){}
}

class SonicPiCommandDescription {
    public readonly command:string;
    public readonly formattedCommand:MarkdownString[];
    public readonly parameters:SonicPiParameterDescription[] | undefined;
    public readonly returns:MarkdownString | undefined;
    public readonly help:MarkdownString |  undefined;
    public readonly examples:MarkdownString[] | undefined;

    constructor(config:{
        command:string
        , formattedCommand?:(string | MarkdownString | ((string | MarkdownString)[]))
        , parameters?:SonicPiParameterDescription[]
        , returns?:string
        , help?:MarkdownString | string
        , examples?:string | string[] | MarkdownString | MarkdownString[]
    }){
        let {
            command
            , formattedCommand
            , parameters
            , returns
            , help
            , examples
        } = config;

        this.command = command;

        if(typeof parameters === 'undefined'){
            this.parameters = [];
        }
        else {
            this.parameters = parameters.map(parm => ({
                    ...parm
                    , editable: typeof parm.editable === 'undefined' ? false : parm.editable
                    , help:(typeof parm.help === 'string' ? new MarkdownString(parm.help) : parm.help)
                })
            );
        }
        if(typeof formattedCommand === 'undefined'){
            if(typeof parameters === 'undefined'){
                formattedCommand = command+" ?";
            }
            else {
                formattedCommand = command+" "+this.parameters.map(x => x.name).join(" ");
            }
        }
        
        if(!Array.isArray(formattedCommand)){
            formattedCommand = [formattedCommand];
        }

        this.formattedCommand = formattedCommand.map(cmd => {
            if(typeof cmd === 'string'){
                if(cmd.indexOf("`") < 0 || cmd.indexOf("    ") !== 0){
                    cmd = `    ${cmd}`;
                }
                return new MarkdownString(cmd);
            }
            return cmd;
        });

        this.parameters.forEach(p => p.help.isTrusted = true);
        this.formattedCommand.forEach((cmd) => {cmd.isTrusted = true;});

        let myReturns;
        if(typeof returns === 'undefined'){
            myReturns = undefined;
        }
        else {
            myReturns = typeof returns === 'string' ? new MarkdownString(returns) : returns;
            myReturns.isTrusted = true;
        }
        this.returns = myReturns;
        
        if(typeof help === 'undefined'){
            this.help = undefined;
        }
        else {
            this.help = typeof help === 'string' ? new MarkdownString(help) : help;
            this.help.isTrusted = true;
        }
        
        if(typeof examples === 'undefined'){
            this.examples = [];
        }
        else if(typeof examples === 'string'){
            this.examples = [new MarkdownString(examples)];
        }
        else if(Array.isArray(examples)){
            this.examples = (examples as (string | MarkdownString)[]).map(x => {
                if(typeof x === 'string'){
                    x = x.replace(/(\s*\r?\n)*$/,'').replace(/\r?\n/g,"\r\n");
                    x = new MarkdownString(`~~~
${x}
~~~
`
                    );
                }
                return x;
            });
        }
        else {
            this.examples = [examples];
        }
        this.examples.forEach(x => x.isTrusted = true);
    }

    public format(detailLevel:CodeHelpDetailLevel, withCommand:boolean=true): MarkdownString | undefined {
        if(detailLevel === CodeHelpDetailLevel.OFF){
            return undefined;
        }
        
        const hline = "\r\n- - -\r\n\r\n";
        let ms = new MarkdownString("");
        ms.isTrusted = true;
        
        ms = ms.appendMarkdown(
            withCommand
            ? this.formattedCommand.map(x => x.value).join("    \n")
            : ""
        );
        if(detailLevel === CodeHelpDetailLevel.MINIMUM){
            return ms;
        }

        ms = ms.appendMarkdown(typeof this.help === 'undefined' ?
            ""
            : (ms.value.length > 0 ? hline : "") + this.help.value
        );

        ms = ms.appendMarkdown(typeof this.parameters === 'undefined' || this.parameters.length === 0 ? "" :
                hline + this.parameters
                    .map(x => 
                    `\`${x.name}\` `
                    + (typeof x.type !== 'undefined' ? `\`${SonicPiTypeDescription[x.type]}\`` : "")
                    + ` ${x.help.value}`)
                    .join("    \r\n")
            )
            .appendMarkdown(typeof this.returns === 'undefined' ? "" :
                "\r\n\r\n" + "Returns: "
                + this.returns.value
            );
        
        if(detailLevel === CodeHelpDetailLevel.NO_EXAMPLES_NO_LINKS){
            return ms;
        }

        if(typeof this.examples !== 'undefined'){
            ms = ms.appendMarkdown(this.examples.length === 0 ? "" :
                hline + "Examples:\r\n\r\n"
                + this.examples.map(x => x.value).join("    \r\n")
            );
        }
        return ms;
    }

}

export interface YamlInfo {
    source: string;
    ydef: object;
}

export class SonicPiLanguageHelpProvider implements HoverProvider, CompletionItemProvider {
    public readonly commandDescriptions: ({[word:string]:SonicPiCommandDescription}) = {};

    constructor(
        private readonly extensionPath: string
        , yamlCommandDefinitions?: YamlInfo[]
    ){
        this.init(yamlCommandDefinitions);
    }
    public init(yamlCommandDefinitions?:YamlInfo[]){
        const defaultSources = ["synth.yaml"].map(x => path.join(this.extensionPath, x));

        const combinedDefinitions = [
                ...(typeof yamlCommandDefinitions === 'undefined' ? defaultSources : [])
            ].map((defPath) => {
                try {
                    return {source: defPath, ydef: yaml.load(readFileSync(defPath).toString())};
                }
                catch(error){
                    window.showErrorMessage(`Error parsing SonicPi command yaml from ${defPath}: `+error);
                }
                return undefined;
            })
            .filter(x => typeof x !== 'undefined')
            .map(x => x as unknown as (({source: string, ydef: any}))) // makes typescript happy, because it can't infer the !undefined tpye from the filter
            .reduce((x, y) => {
                return [...x, y];
            }, typeof yamlCommandDefinitions === 'undefined' ? [] as YamlInfo[] : yamlCommandDefinitions)
            ;

        const newKeys = combinedDefinitions
            .map(({source, ydef}) => { // parse all yamls
                try {
                    return this.parseYamlDefinitions(ydef);
                }
                catch(error){
                    window.showErrorMessage(`Error loading SonicPi command descriptions from ${source}: `+error);
                }
                return [];
            })
            .reduce( // flatten array of arrays
                (x, y) => {
                    x = [...x, ...y];
                    return x;
                }
            , [])
            .map(cmd => { // add new commands and remember which were added/updated
                this.commandDescriptions[cmd.command] = cmd;
                return cmd.command;
            })
            .reduce((x, y) => { // convert array of added commands to object for faster indexing (see below)
                x[y] = true;
                return x;
            }, {} as ({[key:string]:boolean}))
            ;
        
        Object.keys(this.commandDescriptions)
            .filter(x => typeof (newKeys[x]) === 'undefined') // check if the command is still documented
            .forEach(x => { // if not, remove it
                delete this.commandDescriptions[x];
            });
    }

    public createCommands(): Disposable[] {
        return [
            vscode.commands.registerCommand("sonicpi.codehelp.reload", () => {
                this.init();
            })
        ];
    }

    private parseYamlDefinitions(ydef:object): SonicPiCommandDescription[] {
        return Object.entries(ydef).map(([command, v, ..._]) => {
            if(typeof command !== 'string'){
                throw new Error("Invalid command key type "+(typeof command));
            }

            let parameters:SonicPiParameterDescription[] | undefined = undefined;
            let examples:string[] | undefined = undefined;
            let formattedCommand:string[] = [];
            let help:string | undefined = undefined;
            let returns:string | undefined = undefined;

            if(typeof v === 'object'){
                Object.entries(v === null ? {} : v).map(([property, value, ..._]) => {
                    if(typeof property !== 'string'){
                        throw new Error("Invalid property key type "+(typeof property));
                    }
                    if(property === 'cmd' || property === 'formattedCommand'){
                        if(typeof value === 'string'){
                            formattedCommand = [value];
                        }
                        else if(Array.isArray(value)){
                            formattedCommand = value.filter(x => typeof x === 'string');
                        }
                    }
                    else if(property === 'return' || property === 'returns'){
                        if(typeof value === 'string'){
                            returns = value;
                        }
                    }
                    else if(property === 'help' || property === 'doc'){
                        if(typeof value === 'string'){
                            help = value;
                        }
                    }
                    else if(property === 'parm' || property === 'param' || property === 'params' || property === 'parameters'){
                        if(typeof value === 'object' && value !== null){
                            parameters = [];

                            Object.entries(value).map(([parmName, parmprops, ..._]) => {
                                if(typeof parmName === 'string'){
                                    if(typeof parmprops !== 'string'){
                                        parmprops = ""+parmprops;
                                    }
                                    return new SonicPiParameterDescription(parmName, new MarkdownString(parmprops));
                                }
                                else {
                                    throw new Error("Invalid parameter key type "+(typeof parmName));
                                }
                            })
                            .filter(x => typeof x !== 'undefined')
                            .forEach(x => {
                                (parameters as SonicPiParameterDescription[]).push(x);
                            });
                        }
                    }
                    else if(property === 'example' || property === 'examples'){
                        if(typeof value === 'string'){
                            value = [value];
                        }
                        
                        if(Array.isArray(value)) {
                            examples = value.filter(x => typeof x === 'string');
                        }
                    }
                });
            }
            else if(typeof v === 'string'){
                command = v;
            }
            else {
                throw new Error("Invalid command description value type "+(typeof v));
            }

            return new SonicPiCommandDescription({command, formattedCommand, parameters, returns, help});
        });
    }

    private getWordAtCursor(document:TextDocument, position:Position): ({word:string |  undefined, range:Range | undefined}){
        const line = document.lineAt(position.line).text.replace(/--.*$/,'').replace(/\s+$/,'');
        if(position.character > line.length){
            return {word:undefined, range:undefined};
        }
        let startChar = position.character;
        for(let i=startChar-1;i>=0;i--){
            startChar = i;
            const m = line.charAt(i).match(/^[0-9a-z_]$/i);
            if(m === null || m.length === 0){
                startChar = i+1;
                break;
            }
        }
        let endChar = position.character;
        for(let i=endChar;i<=line.length;i++){
            endChar = i;
            if(i < line.length){
                const m = line.charAt(i).match(/^[0-9a-z_']$/i);
                if(m === null || m.length === 0){
                    break;
                }
            }
        }
        const htext = line.substr(startChar, endChar-startChar);
        return {word:htext, range:new Range(position.line, startChar, position.line, endChar)};
    }

    public provideCompletionItems(
        document: TextDocument
        , position: Position
        , token: CancellationToken
        , context: CompletionContext
    ): ProviderResult<CompletionItem[] | CompletionList> {
        const {word, range} = this.getWordAtCursor(document, position);
        if(typeof word === 'undefined' || typeof range === 'undefined'){
            return undefined;
        }
        const matches = Object.keys(this.commandDescriptions)
            .filter(k => k.startsWith(word))
            .map(k => ({'key':k, 'cdesc':this.commandDescriptions[k]}))
            .map(({key, cdesc}) => {
                const item = new CompletionItem(key);
                let insertCommand = cdesc;

                item.kind = CompletionItemKind.Snippet;

                item.range = range;
                item.detail = cdesc.formattedCommand.map(x => x.value.replace(/`/g,'')).join("    \n");

                if(typeof cdesc.parameters === 'undefined'){
                    item.detail = "SonicPi code";
                }
                else {
                    item.insertText = insertCommand.command
                        + (insertCommand.parameters ? insertCommand.parameters : cdesc.parameters)
                            .filter(x => x.editable)
                            .map(x => x.name)
                            .join(" ");
                }

                return item;
            })
        ;
        return matches;
    }

    public provideHover(document:TextDocument, position:Position, token:CancellationToken): Hover | undefined {
        
        const {word, range} = this.getWordAtCursor(document, position);
        if(typeof word === 'undefined' || typeof range === 'undefined'){
            return undefined;
        }
        let commandDescription = this.commandDescriptions[word];
        if(typeof commandDescription === 'undefined'){
            return undefined;
        }
        const hovermd = commandDescription.format(CodeHelpDetailLevel.FULL, true);
        if(typeof hovermd === 'undefined'){
            return undefined;
        }
        return new Hover(hovermd, range);
    }
}

