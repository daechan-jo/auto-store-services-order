import { CoupangOrder, CoupangOrderInfo, CronType } from '@daechanjo/models';
import { RabbitMQService } from '@daechanjo/rabbitmq';
import { UtilService } from '@daechanjo/util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import moment from 'moment';

@Injectable()
export class OrderService {
  constructor(
    private readonly configService: ConfigService,
    private readonly rabbitmqService: RabbitMQService,
    private readonly utilService: UtilService,
  ) {}

  @Cron('0 */10 * * * *')
  async orderCron() {
    const cronId = this.utilService.generateCronId();
    try {
      const nowTime = moment().format('HH:mm:ss');
      console.log(`${CronType.ORDER}${cronId}-${nowTime}: 자동 발주 시작`);

      await this.orderManagement(CronType.ORDER, cronId);
    } catch (error: any) {
      console.error(`${CronType.ERROR}${CronType.ORDER}${cronId}: `, error);

      await this.rabbitmqService.emit('mail-queue', 'sendErrorMail', {
        cronType: CronType.ORDER,
        store: this.configService.get<string>('STORE'),
        cronId: cronId,
        message: error.message,
      });
    }
  }

  // async orderManagement(type: string, cronId: string) {
  //   const today = moment().format('YYYY-MM-DD');
  //   const yesterday = moment().subtract(1, 'days').format('YYYY-MM-DD');
  //   // const twoDaysAgo = moment().subtract(2, 'days').format('YYYY-MM-DD');
  //   // const threeDaysAgo = moment().subtract(3, 'days').format('YYYY-MM-DD');
  //
  //   const newOrderProducts: CoupangOrder = await this.rabbitmqService.send(
  //     'coupang-queue',
  //     'getCoupangOrderList',
  //     {
  //       cronId: cronId,
  //       type: CronType.ORDER,
  //       // ACCEPT | INSTRUCT
  //       status: 'ACCEPT',
  //       vendorId: this.configService.get<string>('COUPANG_VENDOR_ID')!,
  //       today: today,
  //       yesterday: yesterday,
  //     },
  //   );
  //
  //   if (newOrderProducts.data.length <= 0) {
  //     console.log(`${type}${cronId}: 주문 데이터가 없습니다.`);
  //     return;
  //   }
  //
  //   // orderId 별로 개수를 카운트
  //   const orderCounts = new Map<number, number>();
  //   newOrderProducts.data.forEach((order: CoupangOrderInfo) => {
  //     orderCounts.set(order.orderId, (orderCounts.get(order.orderId) || 0) + 1);
  //   });
  //
  //   // 중복된 orderId를 가진 주문들 (개수가 2개 이상인 것들)
  //   const duplicateOrders: CoupangOrderInfo[] = [];
  //
  //   // 데이터 분리
  //   newOrderProducts.data.forEach((order: CoupangOrderInfo) => {
  //     if (orderCounts.get(order.orderId)! > 1) {
  //       duplicateOrders.push(order);
  //     }
  //   });
  //
  //   if (duplicateOrders.length >= 1) {
  //     console.log(`${type}${cronId}: 총 ${duplicateOrders.length}개의 중복 주문이 있습니다.`);
  //     // todo 메일 로직
  //   }
  //
  //   const mergedOrders = this.mergeOrdersByIdAndReceiver(newOrderProducts.data);
  //
  //   // 묶음배송아이디
  //   const shipmentBoxIds = newOrderProducts.data.map((item) => item.shipmentBoxId);
  //
  //   // 새로운 모든 주문 상품준비중 처리
  //   await this.rabbitmqService.emit('coupang-queue', 'putOrderStatus', {
  //     cronId: cronId,
  //     type: CronType.ORDER,
  //     shipmentBoxIds: shipmentBoxIds,
  //   });
  //   // await this.rabbitmqService.emit('coupang-queue', 'orderStatusUpdate', {
  //   //   cronId: cronId,
  //   //   type: CronType.ORDER,
  //   // });
  //
  //   const result = await this.rabbitmqService.send('onch-queue', 'automaticOrdering', {
  //     cronId: cronId,
  //     store: this.configService.get<string>('STORE'),
  //     newOrderProducts: mergedOrders,
  //     type: CronType.ORDER,
  //   });
  //
  //   const successOrders = result.data.filter((result: any) => result.status === 'success');
  //   const failedOrders = result.data.filter((result: any) => result.status === 'failed');
  //
  //   if (successOrders.length > 0) {
  //     try {
  //       setImmediate(async () => {
  //         await this.rabbitmqService.emit('mail-queue', 'sendSuccessOrders', {
  //           result: successOrders,
  //           store: this.configService.get<string>('STORE'),
  //         });
  //       });
  //       console.log(`${type}${cronId}: 성공 이메일 전송 완료`);
  //     } catch (error: any) {
  //       console.error(
  //         `${CronType.ERROR}${type}${cronId}: 성공 이메일 전송 실패\n`,
  //         error.response?.data || error.message,
  //       );
  //     }
  //   }
  //
  //   if (failedOrders.length > 0) {
  //     try {
  //       setImmediate(async () => {
  //         await this.rabbitmqService.emit('mail-queue', 'sendFailedOrders', {
  //           result: failedOrders,
  //           store: this.configService.get<string>('STORE'),
  //           cronId: cronId,
  //         });
  //       });
  //       console.log(`${type}${cronId}: 실패 이메일 전송 완료`);
  //     } catch (error: any) {
  //       console.error(
  //         `${CronType.ERROR}${type}${cronId}: 실패 이메일 전송 실패\n`,
  //         error.response?.data || error.message,
  //       );
  //     }
  //   }
  // }

  /**
   * 쿠팡 주문을 관리하는 함수
   *
   * @description
   * 이 함수는 다음과 같은 작업을 수행합니다:
   * 1. 쿠팡에서 신규 주문 데이터를 가져옵니다
   * 2. 중복 주문을 확인하고 처리합니다
   * 3. 주문 상태를 '상품준비중'으로 업데이트합니다
   * 4. 자동 주문 처리를 진행합니다
   * 5. 성공 및 실패한 주문에 대해 이메일을 발송합니다
   *
   * @param {string} type - 크론 작업 유형
   * @param {string} cronId - 크론 작업 식별자
   * @returns {Promise<void>} 작업 완료 시 Promise 반환
   */
  async orderManagement(type: string, cronId: string): Promise<void> {
    try {
      // 1. 날짜 설정 및 신규 주문 데이터 가져오기
      const { newOrderProducts } = await this.fetchNewOrders(type, cronId);

      // 주문 데이터가 없으면 종료
      if (newOrderProducts.data.length <= 0) {
        console.log(`${type}${cronId}: 주문 데이터가 없습니다.`);
        return;
      }

      // 2. 중복 주문 확인
      this.handleDuplicateOrders(newOrderProducts.data, type, cronId);

      // 3. 주문 병합 및 상태 업데이트
      const mergedOrders = await this.mergeOrdersByIdAndReceiver(newOrderProducts.data);
      await this.updateOrderStatus(newOrderProducts.data, cronId);

      // 4. 자동 주문 처리
      const result = await this.processAutomaticOrdering(mergedOrders, cronId);

      // 5. 이메일 발송
      await this.sendOrderNotifications(result, type, cronId);
    } catch (error: any) {
      console.error(
        `${CronType.ERROR}${type}${cronId}: 주문 관리 중 오류 발생\n`,
        error.response?.data || error.message,
      );
    }
  }

  /**
   * 쿠팡에서 신규 주문 데이터를 가져옵니다
   *
   * @param {string} type - 크론 작업 유형
   * @param {string} cronId - 크론 작업 식별자
   * @returns {Promise<{newOrderProducts: CoupangOrder}>} 가져온 주문 데이터
   * @private
   */
  private async fetchNewOrders(
    type: string,
    cronId: string,
  ): Promise<{ newOrderProducts: CoupangOrder }> {
    const today = moment().format('YYYY-MM-DD');
    const yesterday = moment().subtract(1, 'days').format('YYYY-MM-DD');

    const newOrderProducts: CoupangOrder = await this.rabbitmqService.send(
      'coupang-queue',
      'getCoupangOrderList',
      {
        cronId: cronId,
        type: CronType.ORDER,
        status: 'ACCEPT',
        vendorId: this.configService.get<string>('COUPANG_VENDOR_ID')!,
        today: today,
        yesterday: yesterday,
      },
    );

    return { newOrderProducts };
  }

  /**
   * 중복된 주문을 확인하고 처리합니다
   *
   * @param {CoupangOrderInfo[]} orders - 주문 데이터 배열
   * @param {string} type - 크론 작업 유형
   * @param {string} cronId - 크론 작업 식별자
   * @private
   */
  private handleDuplicateOrders(orders: CoupangOrderInfo[], type: string, cronId: string): void {
    // orderId 별로 개수 카운트
    const orderCounts = new Map<number, number>();
    orders.forEach((order: CoupangOrderInfo) => {
      orderCounts.set(order.orderId, (orderCounts.get(order.orderId) || 0) + 1);
    });

    // 중복된 orderId를 가진 주문들 찾기
    const duplicateOrders: CoupangOrderInfo[] = orders.filter(
      (order: CoupangOrderInfo) => orderCounts.get(order.orderId)! > 1,
    );

    if (duplicateOrders.length >= 1) {
      console.log(`${type}${cronId}: 총 ${duplicateOrders.length}개의 중복 주문이 있습니다.`);
      // TODO: 중복 주문에 대한 메일 발송 로직 구현
    }
  }

  /**
   * 주문 ID와 수령인 정보를 기준으로 주문을 병합합니다
   *
   * @description
   * 이 함수는 다음과 같은 기준으로 주문을 병합합니다:
   * - 동일한 주문 ID(orderId)를 가지며
   * - 동일한 수령인 정보(이름, 주소1, 주소2, 우편번호)를 가진 주문을
   * 하나의 주문으로 병합하고, 각 주문의 orderItems는 배열에 병합됩니다.
   *
   * @param {CoupangOrderInfo[]} orders - 병합할 쿠팡 주문 정보 배열
   * @returns {Promise<CoupangOrderInfo[]>} 병합된 주문 정보 배열
   * @private
   */
  private async mergeOrdersByIdAndReceiver(
    orders: CoupangOrderInfo[],
  ): Promise<CoupangOrderInfo[]> {
    const mergedOrdersMap = new Map<string, CoupangOrderInfo>();

    orders.forEach((order) => {
      const receiverKey = `${order.receiver.name}_${order.receiver.addr1}_${order.receiver.addr2}_${order.receiver.postCode}`;
      const key = `${order.orderId}_${receiverKey}`;

      if (mergedOrdersMap.has(key)) {
        const existingOrder = mergedOrdersMap.get(key)!;
        // 배열을 any[]로 타입 단언
        (existingOrder.orderItems as any[]).push(...order.orderItems);
      } else {
        mergedOrdersMap.set(key, { ...order });
      }
    });

    return Array.from(mergedOrdersMap.values());
  }

  /**
   * 주문 상태를 업데이트합니다
   *
   * @param {CoupangOrderInfo[]} orders - 주문 데이터 배열
   * @param {string} cronId - 크론 작업 식별자
   * @returns {Promise<void>} 작업 완료 시 Promise 반환
   * @private
   */
  private async updateOrderStatus(orders: CoupangOrderInfo[], cronId: string): Promise<void> {
    // 묶음배송아이디 추출
    const shipmentBoxIds = orders.map((item) => item.shipmentBoxId);

    // 모든 주문 상품준비중 처리
    await this.rabbitmqService.emit('coupang-queue', 'putOrderStatus', {
      cronId: cronId,
      type: CronType.ORDER,
      shipmentBoxIds: shipmentBoxIds,
    });
  }

  /**
   * 온채널 주문 처리를 진행합니다
   *
   * @param {any[]} mergedOrders - 병합된 주문 데이터
   * @param {string} cronId - 크론 작업 식별자
   * @returns {Promise<{data: any[]}>} 자동 주문 처리 결과
   * @private
   */
  private async processAutomaticOrdering(
    mergedOrders: any[],
    cronId: string,
  ): Promise<{ data: any[] }> {
    return await this.rabbitmqService.send('onch-queue', 'automaticOrdering', {
      cronId: cronId,
      store: this.configService.get<string>('STORE'),
      newOrderProducts: mergedOrders,
      type: CronType.ORDER,
    });
  }

  /**
   * 주문 알림 이메일을 발송합니다
   *
   * @param {{data: any[]}} result - 자동 주문 처리 결과
   * @param {string} type - 크론 작업 유형
   * @param {string} cronId - 크론 작업 식별자
   * @returns {Promise<void>} 작업 완료 시 Promise 반환
   * @private
   */
  private async sendOrderNotifications(
    result: { data: any[] },
    type: string,
    cronId: string,
  ): Promise<void> {
    const successOrders = result.data.filter((result: any) => result.status === 'success');
    const failedOrders = result.data.filter((result: any) => result.status === 'failed');

    // 성공 주문 이메일 발송
    if (successOrders.length > 0) {
      await this.sendEmailNotification({
        orders: successOrders,
        type,
        cronId,
        isSuccess: true,
      });
    }

    // 실패 주문 이메일 발송
    if (failedOrders.length > 0) {
      await this.sendEmailNotification({
        orders: failedOrders,
        type,
        cronId,
        isSuccess: false,
        includeCronId: true,
      });
    }
  }

  /**
   * 이메일 알림을 발송합니다
   *
   * @param {Object} options - 이메일 발송 옵션
   * @param {any[]} options.orders - 주문 데이터
   * @param {string} options.type - 크론 작업 유형
   * @param {string} options.cronId - 크론 작업 식별자
   * @param {boolean} options.isSuccess - 성공 여부
   * @param {boolean} [options.includeCronId=false] - cronId 포함 여부
   * @returns {Promise<void>} 작업 완료 시 Promise 반환
   * @private
   */
  private async sendEmailNotification({
    orders,
    type,
    cronId,
    isSuccess,
    includeCronId = false,
  }: {
    orders: any[];
    type: string;
    cronId: string;
    isSuccess: boolean;
    includeCronId?: boolean;
  }): Promise<void> {
    try {
      const emailType = isSuccess ? 'sendSuccessOrders' : 'sendFailedOrders';
      const statusText = isSuccess ? '성공' : '실패';

      const emailData: any = {
        result: orders,
        store: this.configService.get<string>('STORE'),
      };

      // 실패 이메일에만 cronId 포함
      if (includeCronId) {
        emailData.cronId = cronId;
      }

      setImmediate(async () => {
        await this.rabbitmqService.emit('mail-queue', emailType, emailData);
      });

      console.log(`${type}${cronId}: ${statusText} 이메일 전송 완료`);
    } catch (error: any) {
      console.error(
        `${CronType.ERROR}${type}${cronId}: ${isSuccess ? '성공' : '실패'} 이메일 전송 실패\n`,
        error.response?.data || error.message,
      );
    }
  }
}
