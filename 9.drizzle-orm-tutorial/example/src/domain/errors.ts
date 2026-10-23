// 领域错误：Service 层把数据库错误翻译成业务能理解的错误，HTTP 层再翻译成状态码
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class EmailTakenError extends AppError {
  constructor(email: string) {
    super("EMAIL_TAKEN", `邮箱已被注册：${email}`);
  }
}

export class BookNotFoundError extends AppError {
  constructor(readonly bookId: number) {
    super("BOOK_NOT_FOUND", `图书不存在：${bookId}`);
  }
}

export class OutOfStockError extends AppError {
  constructor(readonly bookId: number) {
    super("OUT_OF_STOCK", `库存不足：${bookId}`);
  }
}

export class NotPurchasedError extends AppError {
  constructor(readonly bookId: number) {
    super("NOT_PURCHASED", `只有购买过的用户才能评价：${bookId}`);
  }
}
