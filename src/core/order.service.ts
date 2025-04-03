import { CoupangOrder, JobType, OrderStatus } from '@daechanjo/models';
import { RabbitMQService } from '@daechanjo/rabbitmq';
import { UtilService } from '@daechanjo/util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import moment from 'moment';
import JSONbig from 'json-bigint';

@Injectable()
export class OrderService {
  constructor(
    private readonly configService: ConfigService,
    private readonly rabbitmqService: RabbitMQService,
    private readonly utilService: UtilService,
  ) {}

  @Cron('0 */10 * * * *')
  async orderCron() {
    const jobId = this.utilService.generateCronId();
    try {
      const nowTime = moment().format('HH:mm:ss');
      console.log(`${JobType.ORDER}${jobId}-${nowTime}: 자동 발주 시작`);

      await this.orderManagement(JobType.ORDER, jobId);
    } catch (error: any) {
      console.error(`${JobType.ERROR}${JobType.ORDER}${jobId}: `, error);

      await this.rabbitmqService.emit('mail-queue', 'sendErrorMail', {
        jobType: JobType.ORDER,
        store: this.configService.get<string>('STORE'),
        jobId: jobId,
        message: error.message,
      });
    }
  }

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
   * @param {string} jobType - 크론 작업 유형
   * @param {string} jobId - 크론 작업 식별자
   * @returns {Promise<void>} 작업 완료 시 Promise 반환
   */
  async orderManagement(jobType: string, jobId: string): Promise<void> {
    try {
      // 1. 날짜 설정 및 신규 주문 데이터 가져오기
      const responseData = await this.fetchNewOrders(jobType, jobId);
      const newOrders: CoupangOrder[] = JSONbig.parse(responseData);

      // 주문 데이터가 없으면 종료
      if (newOrders.length <= 0) {
        console.log(`${jobType}${jobId}: 주문 데이터가 없습니다.`);
        return;
      }

      // 3. 주문 병합 및 상태 업데이트
      await this.updateOrderStatus(newOrders, jobId);
      const mergedOrders = await this.mergeOrders(newOrders);

      // 4. 주문 처리
      const result = await this.rabbitmqService.send('onch-queue', 'automaticOrdering', {
        jobId: jobId,
        jobType: JobType.ORDER,
        store: this.configService.get<string>('STORE'),
        data: mergedOrders,
      });

      // 5. 이메일 발송
      await this.sendOrderNotifications(result, jobType, jobId);
    } catch (error: any) {
      console.error(`${JobType.ERROR}${jobType}${jobId}: 주문 관리 중 오류 발생\n`, error);
    }
  }

  /**
   * 쿠팡에서 신규 주문 데이터를 가져옵니다
   *
   * @param {string} jobType - 크론 작업 유형
   * @param {string} jobId - 크론 작업 식별자
   * @returns {Promise<string>} 가져온 주문 데이터
   * @private
   */
  private async fetchNewOrders(jobType: string, jobId: string): Promise<string> {
    const newOrderProducts: { status: string; data: string } = await this.rabbitmqService.send(
      'coupang-queue',
      'newGetCoupangOrderList',
      {
        jobId: jobId,
        jobType: jobType,
        data: OrderStatus.ACCEPT,
      },
    );

    return newOrderProducts.data;
  }

  private async mergeOrders(orders: CoupangOrder[]) {
    const mergedOrders: CoupangOrder[] = [];

    // 이미 처리된 주문의 인덱스를 저장하는 Set
    const processedIndices = new Set<number>();

    // 각 주문에 대해
    for (let i = 0; i < orders.length; i++) {
      // 이미 처리된 주문이면 건너뛰기
      if (processedIndices.has(i)) continue;

      const currentOrder = orders[i];
      const currentProductCode = currentOrder.items[0].vendorInventoryItemName.split(' ')[0];

      // 현재 주문과 병합할 수 있는 다른 주문들 찾기
      const ordersToMerge: CoupangOrder[] = [];

      for (let j = i + 1; j < orders.length; j++) {
        // 이미 처리된 주문이면 건너뛰기
        if (processedIndices.has(j)) continue;

        const otherOrder = orders[j];
        const otherProductCode = otherOrder.items[0].vendorInventoryItemName.split(' ')[0];

        // 병합 조건 확인
        if (
          currentProductCode === otherProductCode &&
          currentOrder.memberId === otherOrder.memberId &&
          currentOrder.memberName === otherOrder.memberName &&
          currentOrder.addr1 === otherOrder.addr1 &&
          currentOrder.addr2 === otherOrder.addr2 &&
          currentOrder.receiverName === otherOrder.receiverName
        ) {
          ordersToMerge.push(otherOrder);
          processedIndices.add(j);
        }
      }

      // 병합할 주문이 있으면 병합
      if (ordersToMerge.length > 0) {
        // 현재 주문의 복사본 생성
        const mergedOrder: CoupangOrder = { ...currentOrder };

        // items 배열 복사
        mergedOrder.items = [...currentOrder.items];

        // 병합할 주문들의 items를 추가
        for (const orderToMerge of ordersToMerge) {
          mergedOrder.items.push(...orderToMerge.items);
        }

        // hasMultipleItems 플래그 업데이트
        mergedOrder.hasMultipleItems = mergedOrder.items.length > 1;

        // 결과 배열에 추가
        mergedOrders.push(mergedOrder);
      } else {
        // 병합할 주문이 없으면 그대로 추가
        mergedOrders.push(currentOrder);
      }

      // 현재 주문을 처리된 것으로 표시
      processedIndices.add(i);
    }

    return mergedOrders;
  }

  /**
   * 주문 상태를 업데이트합니다
   *
   * @param {CoupangScrapOrderItem[]} orders - 주문 데이터 배열
   * @param {string} jobId - 크론 작업 식별자
   * @returns {Promise<void>} 작업 완료 시 Promise 반환
   * @private
   */
  private async updateOrderStatus(orders: CoupangOrder[], jobId: string): Promise<void> {
    // 묶음배송아이디 추출
    const shipmentBoxIds = orders.map((item) => item.shipmentBoxId);

    // 모든 주문 상품준비중 처리
    await this.rabbitmqService.emit('coupang-queue', 'putOrderStatus', {
      jobId: jobId,
      jobType: JobType.ORDER,
      data: shipmentBoxIds,
    });
  }

  /**
   * 주문 알림 이메일을 발송합니다
   *
   * @param {{data: any[]}} result - 자동 주문 처리 결과
   * @param {string} jobType - 크론 작업 유형
   * @param {string} jobId - 크론 작업 식별자
   * @returns {Promise<void>} 작업 완료 시 Promise 반환
   * @private
   */
  private async sendOrderNotifications(
    result: { data: any[] },
    jobType: string,
    jobId: string,
  ): Promise<void> {
    const successOrders = result.data.filter((result: any) => result.status === 'success');
    const failedOrders = result.data.filter((result: any) => result.status === 'failed');

    // 성공 주문 이메일 발송
    if (successOrders.length > 0) {
      await this.sendEmailNotification({
        orders: successOrders,
        jobType,
        jobId,
        isSuccess: true,
      });
    }

    // 실패 주문 이메일 발송
    if (failedOrders.length > 0) {
      await this.sendEmailNotification({
        orders: failedOrders,
        jobType,
        jobId,
        isSuccess: false,
        includejobId: true,
      });
    }
  }

  /**
   * 이메일 알림을 발송합니다
   *
   * @param {Object} options - 이메일 발송 옵션
   * @param {any[]} options.orders - 주문 데이터
   * @param {string} options.jobType - 크론 작업 유형
   * @param {string} options.jobId - 크론 작업 식별자
   * @param {boolean} options.isSuccess - 성공 여부
   * @param {boolean} [options.includejobId=false] - jobId 포함 여부
   * @returns {Promise<void>} 작업 완료 시 Promise 반환
   * @private
   */
  private async sendEmailNotification({
    orders,
    jobType,
    jobId,
    isSuccess,
    includejobId = false,
  }: {
    orders: any[];
    jobType: string;
    jobId: string;
    isSuccess: boolean;
    includejobId?: boolean;
  }): Promise<void> {
    try {
      const emailType = isSuccess ? 'sendSuccessOrders' : 'sendFailedOrders';
      const statusText = isSuccess ? '성공' : '실패';

      const emailData: any = {
        result: orders,
        store: this.configService.get<string>('STORE'),
      };

      // 실패 이메일에만 jobId 포함
      if (includejobId) {
        emailData.jobId = jobId;
      }

      setImmediate(async () => {
        await this.rabbitmqService.emit('mail-queue', emailType, emailData);
      });

      console.log(`${jobType}${jobId}: ${statusText} 이메일 전송 완료`);
    } catch (error: any) {
      console.error(
        `${JobType.ERROR}${jobType}${jobId}: ${isSuccess ? '성공' : '실패'} 이메일 전송 실패\n`,
        error.response?.data || error.message,
      );
    }
  }
}
