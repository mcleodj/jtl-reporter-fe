import { Component, OnDestroy, OnInit } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { ItemsApiService } from "../items-api.service";
import { ItemDetail } from "../items.service.model";
import { NgxSpinnerService } from "ngx-spinner";
import { DecimalPipe } from "@angular/common";
import * as Highcharts from "highcharts";
import exporting from "highcharts/modules/exporting";

exporting(Highcharts);

import { overallChartSettings } from "../graphs/item-detail";
import { catchError, withLatestFrom } from "rxjs/operators";
import { of } from "rxjs";
import { SharedMainBarService } from "../shared-main-bar.service";
import { ToastrService } from "ngx-toastr";
import { bytesToMbps } from "./calculations";
import { ItemStatusValue } from "./item-detail.model";
import { Metrics } from "./metrics";
import { AnalyzeChartService } from "../analyze-chart.service";
import { showZeroErrorWarning } from "../utils/showZeroErrorTolerance";
import { ItemChartService } from "../_services/item-chart.service";

@Component({
  selector: "app-item-detail",
  templateUrl: "./item-detail.component.html",
  styleUrls: ["./item-detail.component.scss", "../shared-styles.css"],
  providers: [DecimalPipe]
})
export class ItemDetailComponent implements OnInit, OnDestroy {

  Highcharts: typeof Highcharts = Highcharts;
  itemData: ItemDetail = {
    overview: null,
    environment: null,
    baseId: null,
    note: null,
    plot: null,
    extraPlotData: null,
    reportStatus: null,
    hostname: null,
    statistics: [],
    name: null,
    monitoring: {
      cpu: {
        max: 0, data: []
      }
    },
    analysisEnabled: null,
    zeroErrorToleranceEnabled: null,
    topMetricsSettings: null,
    userSettings: null,
  };
  overallChartOptions;
  updateChartFlag = false;
  monitoringChart;
  itemParams;
  hasErrorsAttachment;
  Math: any;
  token: string;
  isAnonymous = false;
  toggleThroughputBandFlag = false;
  chartLines;
  activeId = 1;
  performanceAnalysisLines = null;
  externalSearchTerm = null;
  totalRequests = null;
  overallChart = null;

  constructor(
    private route: ActivatedRoute,
    private itemsService: ItemsApiService,
    private spinner: NgxSpinnerService,
    private sharedMainBarService: SharedMainBarService,
    private toastr: ToastrService,
    private analyzeChartService: AnalyzeChartService,
    private itemChartService: ItemChartService,
  ) {
    this.Math = Math;
  }


  async ngOnInit() {
    this.spinner.show();
    this.route.params.pipe(
      withLatestFrom(_ => {
        this.sharedMainBarService.setProjectName(_.projectName);
        return _;
      })
    ).subscribe(_ => this.itemParams = _);
    this.route.queryParams.subscribe(_ => {
      this.token = _.token;
      if (this.token) {
        this.isAnonymous = true;
      }
    });
    this.itemsService.fetchItemDetail(
      this.itemParams.projectName,
      this.itemParams.scenarioName,
      this.itemParams.id,
      { token: this.token }
    )
      .pipe(catchError(r => {
        this.spinner.hide();
        return of(r);
      }))
      .subscribe((results) => {
        this.itemData = results;
        this.monitoringAlerts();
        this.itemChartService.setCurrentPlot(this.itemData.plot)
        this.calculateTotalRequests();
        this.spinner.hide();
      });
    this.analyzeChartService.currentData.subscribe(data => {
      if (data) {
        this.activeId = 2;
      }
    });

    this.overallChartOptions = {
      ...overallChartSettings("ms")
    };

    this.itemChartService.selectedPlot$.subscribe((value) => {
      this.chartLines = value.chartLines;

      if (this.chartLines) {
        const oveallChartSeries = Array.from(this.chartLines?.overall?.values());
        this.overallChartOptions.series = JSON.parse(JSON.stringify(oveallChartSeries))

      }

      this.updateChartFlag = true
    });
  }

  ngOnDestroy() {
    this.toastr.clear();
  }

  private calculateTotalRequests() {
    this.totalRequests = this.itemData.statistics.reduce((accumulator, currentValue) => {
      return accumulator + currentValue.samples;
    }, 0);
  }



  itemDetailChanged({ note, environment, hostname, name }) {
    this.itemData.note = note;
    this.itemData.environment = environment;
    this.itemData.hostname = hostname;
    this.itemData.name = name
  }

  monitoringAlerts() {
    const alertMessages = [];
    const { max: maxCpu } = this.itemData.monitoring.cpu;
    if (maxCpu > 90) {
      alertMessages.push(`High CPU usage`);
    }

    if (alertMessages.length > 0) {
      this.toastr.warning(alertMessages.join("<br>"), "Monitoring Alert!",
        {
          closeButton: true,
          disableTimeOut: true,
          enableHtml: true,
        });
    }
  }

  getTextStatus(status) {
    for (const k in ItemStatusValue) {
      if (ItemStatusValue[k] === status) {
        return k;
      }
    }
  }

  toggleThroughputBand({ element, perfAnalysis }) {
    this.overallChartOptions.series.forEach(serie => {
      if (["response time", "errors"].includes(serie.name)) {
        serie.visible = this.toggleThroughputBandFlag;
      }
      if (serie.name === "throughput") {
        if (this.toggleThroughputBandFlag) {
          serie.zones = [];
          return;
        }
        serie.zones = [{
          value: this.itemData.overview.throughput,
          color: "#e74c3c"
        }];
      }
    });

    if (!this.toggleThroughputBandFlag) {
      element.textContent = "Hide in chart";
      this.overallChartOptions.xAxis.plotBands = {
        color: "#e74c3c4f",
        from: perfAnalysis.throughputVariability.bandValues[0],
        to: perfAnalysis.throughputVariability.bandValues[1]
      };
      this.toggleThroughputBandFlag = true;
    } else {
      element.textContent = "Display in chart";
      this.overallChartOptions.xAxis.plotBands = null;
      this.toggleThroughputBandFlag = false;
    }
    this.updateChartFlag = true;
  }

  convertBytesToMbps(bytes) {
    return bytesToMbps(bytes);
  }

  showZeroErrorToleranceWarning(): boolean | string {
    if (this.itemData.zeroErrorToleranceEnabled) {
      return showZeroErrorWarning(this.itemData.overview.errorRate,
        this.itemData.overview.errorCount);
    }
    return false;
  }

  focusOnLabel($event: { label: string, metrics: Metrics[] }) {
    this.activeId = 2;
    this.performanceAnalysisLines = $event;
    this.externalSearchTerm = $event.label;
  }

  chartCallback: Highcharts.ChartCallbackFunction = function (chart): void {
    setTimeout(() => {
        chart.reflow();
    },0);
}
}
