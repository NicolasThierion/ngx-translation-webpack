import * as _ from 'lodash';
import { readDir } from './utils';
import * as globToRegExp from 'glob-to-regexp'
import { Log } from './log';
import {
  CompilerFactory, TranslationCollection
} from './ngx-import'
import * as fs from 'fs';
import * as path from 'path';
import { CompilerInterface } from '@biesbjerg/ngx-translate-extract';
import * as mkdirp from 'mkdirp';

export class NgxTranslateMerger {
  output: { [key: string]: TranslationCollection; };
  private _options: NgxTranslateMerger.MergerOptions;

  constructor(options: NgxTranslateMerger.MergerOptions = {}) {
      this._options = _.merge(options, {
      input: ['./src'],
      patterns: [`**/i18n/*.%lang%.po`, `**/i18n/*.%lang%.json`],
      output: ['gen/i18n/%lang%.json'],
      format: 'json'
    });
  }

  execute() {
    const o = this._options as any;
    const translationFiles = this._findTranslationFiles();
    const languagesMap = this._findLanguages(translationFiles);
    Log.debug(`Found languages : ${Object.keys(languagesMap)}`);

    this.output = this._extractTranslationCollections(languagesMap);
    this._save(this.output );
  }

  private _findLanguages(files: string[]): {[key: string]: string[]} {
    const regexes = (this._options as any).patterns
      .map(globToRegExp)
      .map(r => r.source)
      .map(s => s.replace('%lang%', '(.*)'));

    // infer available languages from found translation files
    return files.reduce((values, filename) => {
      regexes
        .map(re => filename.match(re))
        .filter(match => !!match)
        .forEach(match => {
          const path = match[0];
          const lang = match[1];
          if (!values[lang]) {
            values[lang] = [];
          }
          values[lang].push(path);
        });
      return values;
    }, {});
  }

  private _findTranslationFiles() {
    const o = this._options as any;
    const files: string[] = [];
    const pattern = o.patterns.map(s => s.replace('%lang%', '*'));

    o.input.forEach(dir => {
      readDir(dir, pattern)
        .forEach(p => {
          files.push(p);
        })
    });
    return files;
  }

  private _extractTranslationCollections(translationFiles: {[key: string]: string[]}): {[key: string]: TranslationCollection} {
    const compilers = [
      CompilerFactory.create('pot', {}),
      CompilerFactory.create('json', {})
    ];
    const collections = {};
    for (const lang of Object.keys(translationFiles)) {
      const paths = translationFiles[lang];
      collections[lang] = new TranslationCollection();
      for (const compiler of compilers) {

        collections[lang] = paths
          .filter(p => path.extname(p) === `.${compiler.extension}`)
          .map(p => fs.readFileSync(p, 'utf-8'))
          .map(compiler.parse.bind(compiler))
          .reduce((acc: TranslationCollection, c: TranslationCollection) => acc.union(c), collections[lang]);
      }
    }

    return collections;
  }

  private _save(collections: { [p: string]: TranslationCollection }) {
    const o = this._options as any;
    const compiler: CompilerInterface = CompilerFactory.create(o.format == 'po' ? 'pot' : o.format, {});

    o.output.forEach(output => {
      for (const lang of Object.keys(collections)) {
        const notmalizedOutput = path.resolve(output.replace('%lang%', lang));
        let dir: string = notmalizedOutput;
        let filename: string = `${lang}.${compiler.extension}`;
        if (!fs.existsSync(notmalizedOutput) || !fs.statSync(notmalizedOutput).isDirectory()) {
          dir = path.dirname(notmalizedOutput);
          filename = path.basename(notmalizedOutput);
        }

        const outputPath: string = path.join(dir, filename);


        let processedCollection: TranslationCollection = collections[lang];
        Log.debug(`\nSaving: ${outputPath}`);
        processedCollection = processedCollection.sort();

        if (!fs.existsSync(dir)) {
          mkdirp.sync(dir);
        }
        fs.writeFileSync(outputPath, compiler.compile(processedCollection));
      }
      Log.debug('Done!');
    });
  }
}

export namespace NgxTranslateMerger {

  export interface MergerOptions {
    input?: string[];
    pattern?: string;
    inputFormat?: 'json' | 'po';
    output?: string[];
    outputFormat?: 'json' | 'po';
  }

}
