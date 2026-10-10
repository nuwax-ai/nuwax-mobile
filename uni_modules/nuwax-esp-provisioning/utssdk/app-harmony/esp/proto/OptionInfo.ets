/** Generator option information. **/
export class GeneratorOption {
  sendable: boolean;
  name: Array<string>;
  alias: Array<string>;

  /**
  * Constructs a new generator option object.
  * @param [boolean] sendable to set
  * @param [Array<string>] name array to set
  * @param [Array<string>] alias array to set
  */
  constructor(sendable: boolean, name: Array<string>, alias: Array<string>) {
    this.sendable = sendable;
    this.name = name;
    this.alias = alias;
  }
}

/** Message option information. **/
export class MessageOption {
  typeUrl: string;
  createInstanceFunc: () => ESObject;
  option: GeneratorOption;

  /**
  * Constructs a new message option object.
  * @param [string] type url to set
  * @param [function] function to set
  * @param [GeneratorOption] generator option to set
  */
  constructor(typeUrl: string, createInstanceFunc: () => ESObject, option: GeneratorOption) {
    this.typeUrl = typeUrl;
    this.createInstanceFunc = createInstanceFunc;
    this.option = option;
  }
}
